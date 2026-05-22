#!/usr/bin/env python3
"""
Citizen Matters (Bengaluru) RSS scraper for the NestIQ locality feed.

Fetches the Bengaluru city archive RSS — no API key required.

Usage:
    python -m ingestion.scrape_citizen_matters --dry-run   # fetch + print, no DB writes
    python -m ingestion.scrape_citizen_matters             # insert into locality_feed
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

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
logger = logging.getLogger("scrape_citizen_matters")

RSS_URL = "https://citizenmatters.in/city/bengaluru/feed/"
SOURCE = "citizen_matters"

NS = {
    "dc": "http://purl.org/dc/elements/1.1/",
    "slash": "http://purl.org/rss/1.0/modules/slash/",
}


def strip_html(html: str) -> str:
    if not html:
        return ""
    text = BeautifulSoup(html, "lxml").get_text(separator=" ", strip=True)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s*The post .+$", "", text, flags=re.IGNORECASE).strip()
    return text


def parse_post_id(guid: str | None) -> str | None:
    if not guid:
        return None
    match = re.search(r"[?&]p=(\d+)", guid)
    if match:
        return match.group(1)
    return guid.strip() or None


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


def fetch_rss_items() -> list[dict]:
    resp = requests.get(
        RSS_URL,
        timeout=20,
        headers={"User-Agent": "NestIQ-PulseBot/1.0 (+https://nestiq.homes)"},
    )
    resp.raise_for_status()

    root = ET.fromstring(resp.content)
    channel = root.find("channel")
    if channel is None:
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    items = []

    for item in channel.findall("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        guid = (item.findtext("guid") or link).strip()
        description = item.findtext("description") or ""
        author = (item.findtext("dc:creator", namespaces=NS) or "").strip()
        pub_raw = item.findtext("pubDate")
        posted_at = parse_published_at(pub_raw)

        if posted_at and posted_at < cutoff:
            logger.debug("Skipping stale item: %s", title[:60])
            continue

        categories = [
            (cat.text or "").strip()
            for cat in item.findall("category")
            if (cat.text or "").strip()
        ]
        comments_raw = item.findtext("slash:comments", namespaces=NS)
        try:
            engagement = int(comments_raw) if comments_raw else 0
        except ValueError:
            engagement = 0

        body_text = strip_html(description)
        if categories:
            body_text = f"{body_text}\n\nCategories: {', '.join(categories)}".strip()

        source_id = parse_post_id(guid)
        if not title or not link or not source_id:
            continue

        items.append(
            {
                "source_id": source_id,
                "title": title[:500],
                "body": body_text[:1000],
                "url": link,
                "author": author or "Citizen Matters",
                "engagement": engagement,
                "posted_at": posted_at,
                "categories": categories,
            }
        )

    return items


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
                    (%s, %s, NULL, %s, %s, %s,
                     %s, %s, %s, NOW())
                ON CONFLICT (source, source_id) DO NOTHING
                """,
                (
                    SOURCE,
                    art["source_id"],
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


def print_dry_run_report(articles: list[dict]) -> None:
    print("\n" + "=" * 72)
    print("CITIZEN MATTERS (BENGALURU) — DRY RUN")
    print("=" * 72)
    print(f"RSS URL:     {RSS_URL}")
    print(f"Max age:     90 days (RSS returns ~10 latest posts)")
    print(f"Articles:    {len(articles)}")
    print("=" * 72)

    for i, art in enumerate(articles, start=1):
        posted = art["posted_at"].strftime("%Y-%m-%d %H:%M UTC") if art["posted_at"] else "unknown"
        cats = ", ".join(art["categories"]) if art["categories"] else "—"
        print(f"\n[{i}] {art['title']}")
        print(f"    ID:         {art['source_id']}")
        print(f"    Author:     {art['author']}")
        print(f"    Posted:     {posted}")
        print(f"    Comments:   {art['engagement']}")
        print(f"    Categories: {cats}")
        print(f"    URL:        {art['url']}")
        preview = art["body"][:220] + ("…" if len(art["body"]) > 220 else "")
        print(f"    Body:       {preview}")

    print("\n" + "=" * 72)
    print("Zero database writes performed during dry-run.")
    print("=" * 72)


def main():
    parser = argparse.ArgumentParser(description="Scrape Citizen Matters Bengaluru RSS")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and print articles without writing to the database",
    )
    args = parser.parse_args()

    if args.dry_run:
        logger.info("DRY RUN — fetching RSS (no database writes)")

    started_at = datetime.now(timezone.utc)
    db_run_id = None if args.dry_run else record_run_start(SOURCE)

    logger.info("Fetching Citizen Matters Bengaluru RSS…")
    try:
        articles = fetch_rss_items()
    except Exception as exc:
        logger.error("RSS fetch failed: %s", exc)
        if db_run_id is not None:
            record_run_end(
                db_run_id,
                status="failed",
                error_message=str(exc),
                started_at=started_at,
            )
        sys.exit(1)

    logger.info("Fetched %d articles from RSS", len(articles))

    if args.dry_run:
        print_dry_run_report(articles)
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
        f"\nCitizen Matters scrape complete.\n"
        f"Articles fetched:  {len(articles)}\n"
        f"Articles inserted: {inserted} ({duplicates} duplicates skipped)"
    )

    if inserted > 0:
        from transforms.fast_path import run_post_pulse_transforms

        run_post_pulse_transforms(SOURCE)

    from sync.trigger import trigger_sync_after_completion

    trigger_sync_after_completion(reason="scrape_citizen_matters")


if __name__ == "__main__":
    main()
