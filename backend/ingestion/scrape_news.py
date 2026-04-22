#!/usr/bin/env python3
"""
NewsAPI scraper for the NestIQ locality feed.

Two-tier query strategy (designed for ~36 API calls per run, 2 runs/day):
  1. Locality queries  — top 10 localities × 1 call each  = 10 calls
  2. City-level queries — 8 thematic queries              =  8 calls
     (locality = NULL, assigned by Gemini tagger later)

Total: ~18 calls/run × 2 runs/day = ~36 calls/day (well within 100/day free tier).

Usage:
    python -m ingestion.scrape_news          # from backend/
    python backend/ingestion/scrape_news.py  # from repo root

Required env var:
    NEWS_API_KEY  — from https://newsapi.org/account
"""

from __future__ import annotations

import hashlib
import logging
import os
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import requests

from ingestion.db import get_connection, record_run_start, record_run_end, UpsertStats

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("scrape_news")

# ── Constants ─────────────────────────────────────────────────────────────────

NEWSAPI_URL = "https://newsapi.org/v2/everything"

# Top 10 localities for per-locality queries (highest activity / news coverage)
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

MAX_PER_QUERY  = 10
LOOKBACK_HOURS = 48  # free plan has limited Indian coverage; 48h catches recent articles without duplicate flood


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_api_key() -> str:
    key = os.environ.get("NEWS_API_KEY", "").strip()
    if not key:
        raise RuntimeError("NEWS_API_KEY environment variable is not set")
    return key


def _parse_published_at(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None


# ── API fetch ────────────────────────────────────────────────────────────────

def fetch_articles(query: str, api_key: str) -> list[dict]:
    """Call the NewsAPI /everything endpoint."""
    from_dt = (
        datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_HOURS)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    params = {
        "q":        query,
        "from":     from_dt,
        "pageSize": MAX_PER_QUERY,
        "language": "en",
        "sortBy":   "relevancy",
        "apiKey":   api_key,
    }
    try:
        resp = requests.get(NEWSAPI_URL, params=params, timeout=15)
        if resp.status_code != 200:
            logger.warning("  NewsAPI %d for query '%.50s' — %s", resp.status_code, query, resp.text[:200])
            return []
        return resp.json().get("articles", [])
    except Exception as e:
        logger.error("  Request failed for query '%.50s' — %s", query, e)
        return []


# ── Relevance check ──────────────────────────────────────────────────────────

def _is_relevant(title: str, description: str, locality: str | None) -> bool:
    """Check title + description for relevance to Bangalore / the target locality."""
    text = (title + " " + description).lower()
    if "bangalore" in text or "bengaluru" in text:
        return True
    if locality and locality.lower() in text:
        return True
    return False


# ── DB insert ────────────────────────────────────────────────────────────────

def insert_articles(conn, locality: str | None, articles: list[dict]) -> tuple[int, int]:
    """
    Insert articles into locality_feed.
    locality can be None for city-level queries (Gemini assigns later).
    Returns (inserted_count, duplicate_count).
    """
    inserted = 0
    duplicates = 0
    cur = conn.cursor()

    for art in articles:
        url   = (art.get("url") or "").strip()
        title = (art.get("title") or "").strip()
        description = (art.get("description") or "").strip()

        if not url or not title or title == "[Removed]":
            continue

        if not _is_relevant(title, description, locality):
            logger.debug("  Skipping off-topic: %.80s", title)
            continue

        source_id  = hashlib.md5(url.encode()).hexdigest()
        body       = description[:1000]
        title      = title[:500]
        author     = (art.get("source", {}).get("name") or "").strip()
        posted_at  = _parse_published_at(art.get("publishedAt"))

        try:
            cur.execute(
                """
                INSERT INTO locality_feed
                    (source, source_id, locality, title, body, url,
                     author, engagement, posted_at, scraped_at)
                VALUES
                    ('news', %s, %s, %s, %s, %s,
                     %s, 0, %s, NOW())
                ON CONFLICT (source, source_id) DO NOTHING
                """,
                (source_id, locality, title, body, url, author, posted_at),
            )
            if cur.rowcount == 1:
                inserted += 1
                logger.info("  [+] %.70s", title)
            else:
                duplicates += 1
        except Exception as e:
            logger.error("  Insert failed for %.80s — %s", url, e)
            conn.rollback()
            cur = conn.cursor()

    conn.commit()
    return inserted, duplicates


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    from datetime import datetime, timezone
    started_at = datetime.now(timezone.utc)
    db_run_id  = record_run_start("news")

    api_key = _get_api_key()
    conn    = get_connection()

    total_fetched    = 0
    total_inserted   = 0
    total_duplicates = 0
    api_calls        = 0

    # ── Tier 1: Per-locality queries ──────────────────────────────────────
    logger.info("Tier 1: Fetching news for %d localities", len(TOP_LOCALITIES))

    for locality in TOP_LOCALITIES:
        query = f'{locality} (Bangalore OR Bengaluru)'
        articles = fetch_articles(query, api_key)
        api_calls += 1
        total_fetched += len(articles)
        logger.info("  %s: fetched %d articles", locality, len(articles))

        inserted, dupes = insert_articles(conn, locality, articles)
        total_inserted   += inserted
        total_duplicates += dupes

        time.sleep(0.5)

    # ── Tier 2: City-level thematic queries ───────────────────────────────
    logger.info("Tier 2: Fetching %d city-level thematic queries", len(CITY_QUERIES))

    for query in CITY_QUERIES:
        articles = fetch_articles(query, api_key)
        api_calls += 1
        total_fetched += len(articles)
        logger.info("  '%.50s': fetched %d articles", query, len(articles))

        inserted, dupes = insert_articles(conn, None, articles)
        total_inserted   += inserted
        total_duplicates += dupes

        time.sleep(0.5)

    conn.close()

    stats = UpsertStats()
    stats.total_new = total_inserted
    final_status = "success" if total_inserted > 0 else "partial"
    record_run_end(
        db_run_id,
        status=final_status,
        stats=stats,
        total_fetched=total_fetched,
        error_message=None if final_status == "success" else f"{total_fetched} fetched, 0 new (all duplicates?)",
        started_at=started_at,
    )

    print(
        f"\nNews scrape complete.\n"
        f"API calls made:       {api_calls}\n"
        f"Articles fetched:     {total_fetched}\n"
        f"Articles inserted:    {total_inserted} "
        f"({total_duplicates} duplicates skipped)"
    )

    if total_inserted > 0:
        from transforms.fast_path import run_post_pulse_transforms
        run_post_pulse_transforms("news")


if __name__ == "__main__":
    main()
