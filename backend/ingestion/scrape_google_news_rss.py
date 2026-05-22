#!/usr/bin/env python3
"""
Google News RSS scraper for the NestIQ locality feed.

Free complement to NewsAPI — same two-tier query strategy, RSS/XML instead of JSON.
No API key required.

Usage:
    python -m ingestion.scrape_google_news_rss --dry-run
    python -m ingestion.scrape_google_news_rss
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import requests
from bs4 import BeautifulSoup

from ingestion.db import UpsertStats, get_connection, record_run_end, record_run_start

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("scrape_google_news_rss")

SOURCE = "google_news_rss"
RSS_SEARCH_URL = "https://news.google.com/rss/search"
RSS_PARAMS = "hl=en-IN&gl=IN&ceid=IN:en"
LOOKBACK_HOURS = 48
REQUEST_DELAY_SEC = 0.5

TOP_LOCALITIES = [
    "Indiranagar", "Koramangala", "HSR Layout", "Whitefield",
    "Electronic City", "Hebbal", "BTM Layout", "Marathahalli",
    "Bellandur", "Sarjapur Road",
]

CITY_QUERIES = [
    "Bengaluru OR Bangalore infrastructure metro",
    "Bengaluru OR Bangalore water Cauvery",
    "Bengaluru OR Bangalore traffic",
    "Bengaluru OR Bangalore rent housing",
    "Bengaluru OR Bangalore crime safety",
    "Bengaluru OR Bangalore BBMP potholes",
    "Bengaluru OR Bangalore startups tech",
    "Bengaluru OR Bangalore pollution",
]

HEADERS = {"User-Agent": "NestIQ-PulseBot/1.0 (+https://nestiq.homes)"}


def strip_html(html: str) -> str:
    if not html:
        return ""
    text = BeautifulSoup(html, "lxml").get_text(separator=" ", strip=True)
    return re.sub(r"\s+", " ", text).strip()


def parse_published_at(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw.strip())
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def build_rss_url(query: str) -> str:
    return f"{RSS_SEARCH_URL}?q={quote_plus(query)}&{RSS_PARAMS}"


def _is_relevant(title: str, description: str, locality: str | None) -> bool:
    text = (title + " " + description).lower()
    if "bangalore" in text or "bengaluru" in text:
        return True
    if locality and locality.lower() in text:
        return True
    return False


def _article_source_id(guid: str | None, link: str | None) -> str:
    if guid and guid.strip():
        return guid.strip()
    if link:
        return hashlib.md5(link.encode()).hexdigest()
    return hashlib.md5(os.urandom(16)).hexdigest()


def fetch_query_items(query: str, locality: str | None, label: str) -> list[dict]:
    url = build_rss_url(query)
    resp = requests.get(url, timeout=20, headers=HEADERS)
    resp.raise_for_status()

    root = ET.fromstring(resp.content)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_HOURS)
    items = []

    for item in root.findall(".//item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        guid = (item.findtext("guid") or link).strip()
        description = item.findtext("description") or ""
        pub_raw = item.findtext("pubDate")
        posted_at = parse_published_at(pub_raw)

        source_el = item.find("source")
        publisher = (source_el.text or "").strip() if source_el is not None else ""
        publisher_url = (source_el.get("url") or "").strip() if source_el is not None else ""

        body_text = strip_html(description)
        if not _is_relevant(title, body_text, locality):
            logger.debug("  Skipping off-topic: %.80s", title)
            continue

        if posted_at and posted_at < cutoff:
            logger.debug("  Skipping stale: %.80s", title)
            continue

        if not title or not link:
            continue

        items.append(
            {
                "source_id": _article_source_id(guid, link),
                "title": title[:500],
                "body": body_text[:1000],
                "url": link,
                "author": publisher or "Google News",
                "publisher_url": publisher_url,
                "engagement": 0,
                "posted_at": posted_at,
                "locality": locality,
                "query_label": label,
            }
        )

    return items


def fetch_all_articles() -> tuple[list[dict], int]:
    """Fetch all queries, dedupe by source_id across queries."""
    seen_ids: set[str] = set()
    articles: list[dict] = []
    api_calls = 0

    logger.info("Tier 1: %d locality queries", len(TOP_LOCALITIES))
    for locality in TOP_LOCALITIES:
        query = f"{locality} (Bangalore OR Bengaluru)"
        label = f"locality:{locality}"
        try:
            batch = fetch_query_items(query, locality, label)
        except Exception as exc:
            logger.warning("  Failed query %s — %s", locality, exc)
            batch = []
        api_calls += 1
        logger.info("  %s: fetched %d articles", locality, len(batch))

        for art in batch:
            if art["source_id"] in seen_ids:
                continue
            seen_ids.add(art["source_id"])
            articles.append(art)

        time.sleep(REQUEST_DELAY_SEC)

    logger.info("Tier 2: %d city-level queries", len(CITY_QUERIES))
    for query in CITY_QUERIES:
        label = f"city:{query[:40]}"
        try:
            batch = fetch_query_items(query, None, label)
        except Exception as exc:
            logger.warning("  Failed query '%.50s' — %s", query, exc)
            batch = []
        api_calls += 1
        logger.info("  '%.50s': fetched %d articles", query, len(batch))

        for art in batch:
            if art["source_id"] in seen_ids:
                continue
            seen_ids.add(art["source_id"])
            articles.append(art)

        time.sleep(REQUEST_DELAY_SEC)

    return articles, api_calls


def insert_articles(conn, articles: list[dict]) -> tuple[int, int]:
    inserted = 0
    duplicates = 0
    cur = conn.cursor()

    for art in articles:
        try:
            cur.execute(
                """
                INSERT INTO locality_feed
                    (source, source_id, locality, title, body, url,
                     author, engagement, posted_at, scraped_at)
                VALUES
                    (%s, %s, %s, %s, %s, %s,
                     %s, %s, %s, NOW())
                ON CONFLICT (source, source_id) DO NOTHING
                """,
                (
                    SOURCE,
                    art["source_id"],
                    art.get("locality"),
                    art["title"],
                    art["body"],
                    art["url"],
                    art["author"],
                    art["engagement"],
                    art["posted_at"],
                ),
            )
            if cur.rowcount == 1:
                inserted += 1
                logger.info("  [+] %.70s", art["title"])
            else:
                duplicates += 1
        except Exception as exc:
            logger.error("  Insert failed for %s — %s", art["url"], exc)
            conn.rollback()
            cur = conn.cursor()

    conn.commit()
    return inserted, duplicates


def print_dry_run_report(articles: list[dict], api_calls: int) -> None:
    print("\n" + "=" * 72)
    print("GOOGLE NEWS RSS — DRY RUN")
    print("=" * 72)
    print(f"Lookback:    {LOOKBACK_HOURS} hours")
    print(f"RSS calls:   {api_calls}")
    print(f"Articles:    {len(articles)} (deduped across queries)")
    print("=" * 72)

    for i, art in enumerate(articles, start=1):
        posted = art["posted_at"].strftime("%Y-%m-%d %H:%M UTC") if art["posted_at"] else "unknown"
        loc = art.get("locality") or "— (Gemini assigns)"
        print(f"\n[{i}] {art['title']}")
        print(f"    Query:      {art['query_label']}")
        print(f"    Locality:   {loc}")
        print(f"    Publisher:  {art['author']}")
        print(f"    Posted:     {posted}")
        print(f"    URL:        {art['url'][:90]}…" if len(art["url"]) > 90 else f"    URL:        {art['url']}")
        preview = art["body"][:200] + ("…" if len(art["body"]) > 200 else "")
        if preview:
            print(f"    Body:       {preview}")

    print("\n" + "=" * 72)
    print("Zero database writes performed during dry-run.")
    print("=" * 72)


def main():
    parser = argparse.ArgumentParser(description="Scrape Google News RSS for Bengaluru")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and print articles without writing to the database",
    )
    args = parser.parse_args()

    if args.dry_run:
        logger.info("DRY RUN — fetching Google News RSS (no database writes)")

    started_at = datetime.now(timezone.utc)
    db_run_id = None if args.dry_run else record_run_start(SOURCE)

    try:
        articles, api_calls = fetch_all_articles()
    except Exception as exc:
        logger.error("Fetch failed: %s", exc)
        if db_run_id is not None:
            record_run_end(
                db_run_id,
                status="failed",
                error_message=str(exc),
                started_at=started_at,
            )
        sys.exit(1)

    logger.info(
        "Fetched %d unique articles from %d RSS queries",
        len(articles),
        api_calls,
    )

    if args.dry_run:
        print_dry_run_report(articles, api_calls)
        return

    conn = get_connection()
    inserted, duplicates = insert_articles(conn, articles)
    conn.close()

    stats = UpsertStats()
    stats.total_new = inserted
    final_status = "success" if inserted > 0 else "partial"
    record_run_end(
        db_run_id,
        status=final_status,
        stats=stats,
        total_fetched=len(articles),
        error_message=None if final_status == "success" else f"{len(articles)} fetched, 0 new",
        started_at=started_at,
    )

    print(
        f"\nGoogle News RSS scrape complete.\n"
        f"RSS calls made:       {api_calls}\n"
        f"Articles fetched:     {len(articles)}\n"
        f"Articles inserted:    {inserted} ({duplicates} duplicates skipped)"
    )

    if inserted > 0:
        from transforms.fast_path import run_post_pulse_transforms

        run_post_pulse_transforms(SOURCE)

    from sync.trigger import trigger_sync_after_completion

    trigger_sync_after_completion(reason="scrape_google_news_rss")


if __name__ == "__main__":
    main()
