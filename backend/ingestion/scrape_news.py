#!/usr/bin/env python3
"""
NewsAPI scraper for the NestIQ locality feed.

For each Bengaluru locality, fetches up to 5 recent news articles from
NewsAPI and inserts them into the locality_feed table.  Skips localities
that already have enough recent coverage so repeat runs stay cheap.

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

# Allow running from repo root or backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import requests

from ingestion.db import get_connection

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("scrape_news")

NEWSAPI_URL = "https://newsapi.org/v2/everything"

LOCALITIES = [
    "Indiranagar", "Koramangala", "HSR Layout", "Whitefield",
    "Electronic City", "Hebbal", "Yelahanka", "BTM Layout",
    "JP Nagar", "Marathahalli", "Bellandur", "Jayanagar",
    "Malleshwaram", "Banashankari", "Hoodi", "Banaswadi",
    "HBR Layout", "Sarjapur Road", "KR Puram", "Yeshwanthpur",
]

MAX_PER_LOCALITY = 5
LOOKBACK_HOURS   = 72  # wider window — tighten to 24 once articles are flowing


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_api_key() -> str:
    key = os.environ.get("NEWS_API_KEY", "").strip()
    if not key:
        raise RuntimeError("NEWS_API_KEY environment variable is not set")
    return key


def _parse_published_at(raw: str | None) -> datetime | None:
    """Parse NewsAPI's ISO-8601 publishedAt string to an aware datetime."""
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None


# ── DB checks ────────────────────────────────────────────────────────────────

def _already_covered(conn, locality: str) -> bool:
    """Return True if locality_feed already has >= 5 news rows scraped in the last 24 h."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT COUNT(*) FROM locality_feed
        WHERE source    = 'news'
          AND locality  = %s
          AND scraped_at >= NOW() - INTERVAL '24 hours'
        """,
        (locality,),
    )
    return cur.fetchone()[0] >= MAX_PER_LOCALITY


# ── API fetch ────────────────────────────────────────────────────────────────

def fetch_articles(locality: str, api_key: str) -> list[dict]:
    """Call the NewsAPI /everything endpoint for one locality."""
    from_dt = (
        datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_HOURS)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    params = {
        "q":        f'{locality} (Bangalore OR Bengaluru)',
        "from":     from_dt,
        "pageSize": MAX_PER_LOCALITY,
        "language": "en",
        "sortBy":   "publishedAt",
        "apiKey":   api_key,
    }
    try:
        resp = requests.get(NEWSAPI_URL, params=params, timeout=15)
        if resp.status_code != 200:
            logger.warning(
                "  %s: NewsAPI %d — %s",
                locality, resp.status_code, resp.text[:200],
            )
            return []
        return resp.json().get("articles", [])
    except Exception as e:
        logger.error("  %s: request failed — %s", locality, e)
        return []


# ── DB insert ────────────────────────────────────────────────────────────────

def insert_articles(conn, locality: str, articles: list[dict]) -> tuple[int, int]:
    """
    Insert valid articles into locality_feed.
    Returns (inserted_count, duplicate_count).
    """
    inserted = 0
    duplicates = 0
    cur = conn.cursor()

    for art in articles:
        url   = (art.get("url") or "").strip()
        title = (art.get("title") or "").strip()

        # Skip articles with no URL or a removed title
        if not url or not title or title == "[Removed]":
            logger.debug("  %s: skipping article — missing url or removed title", locality)
            continue

        source_id  = hashlib.md5(url.encode()).hexdigest()
        body       = (art.get("description") or "")[:1000]
        title      = title[:500]
        author     = (art.get("source", {}).get("name") or "").strip()
        posted_at  = _parse_published_at(art.get("publishedAt"))

        try:
            cur.execute(
                """
                INSERT INTO locality_feed
                    (source, source_id, locality, title, body, url,
                     author, engagement, posted_at, topic, sentiment, scraped_at)
                VALUES
                    ('news', %s, %s, %s, %s, %s,
                     %s, 0, %s, NULL, NULL, NOW())
                ON CONFLICT (source, source_id) DO NOTHING
                """,
                (source_id, locality, title, body, url, author, posted_at),
            )
            if cur.rowcount == 1:
                inserted += 1
            else:
                duplicates += 1
        except Exception as e:
            logger.error(
                "  %s: insert failed for %.80s — %s", locality, url, e
            )
            conn.rollback()
            cur = conn.cursor()

    conn.commit()
    return inserted, duplicates


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    api_key = _get_api_key()
    conn    = get_connection()

    localities_processed = 0
    total_fetched        = 0
    total_inserted       = 0
    total_duplicates     = 0

    logger.info("Starting news scrape for %d localities", len(LOCALITIES))

    for locality in LOCALITIES:
        if _already_covered(conn, locality):
            logger.info("  %s: skipping — already have enough recent articles", locality)
            continue

        articles = fetch_articles(locality, api_key)
        localities_processed += 1
        total_fetched += len(articles)
        logger.info("  %s: fetched %d articles", locality, len(articles))

        inserted, dupes = insert_articles(conn, locality, articles)
        total_inserted   += inserted
        total_duplicates += dupes

        # Polite pause — NewsAPI free tier allows ~100 req/day
        time.sleep(0.5)

    conn.close()

    print(
        f"\nNews scrape complete.\n"
        f"Localities processed: {localities_processed}\n"
        f"Articles fetched:     {total_fetched}\n"
        f"Articles inserted:    {total_inserted} "
        f"({total_duplicates} duplicates skipped)"
    )


if __name__ == "__main__":
    main()
