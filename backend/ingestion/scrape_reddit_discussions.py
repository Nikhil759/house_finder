#!/usr/bin/env python3
"""
Reddit discussion scraper for the NestIQ locality feed.

For each Bengaluru locality, searches r/bangalore and r/BangaloreRentals
for neighbourhood discussion posts (not rental listings) and inserts them
into the locality_feed table.

Usage:
    python -m ingestion.scrape_reddit_discussions          # from backend/
    python backend/ingestion/scrape_reddit_discussions.py  # from repo root

Required env vars:
    REDDIT_CLIENT_ID      — Reddit OAuth app client ID
    REDDIT_CLIENT_SECRET  — Reddit OAuth app client secret
"""

from __future__ import annotations

import logging
import os
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import requests

from ingestion.db import get_connection

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("scrape_reddit_discussions")

# ── Constants ─────────────────────────────────────────────────────────────────

_UA = "python:nestiq-ingestion:v2.0 (by /u/nikhil7599)"

SUBREDDITS = [
    "bangalore",
    "bengaluru",
    "BangaloreRentals",
    "FlatandFlatmatesBLR",
    "FlatmatesinBangalore",
]

MIN_SCORE = 3   # skip posts with fewer upvotes than this

LOCALITIES = [
    "Indiranagar", "Koramangala", "HSR Layout", "Whitefield",
    "Electronic City", "Hebbal", "Yelahanka", "BTM Layout",
    "JP Nagar", "Marathahalli", "Bellandur", "Jayanagar",
    "Malleshwaram", "Banashankari", "Hoodi", "Banaswadi",
    "HBR Layout", "Sarjapur Road", "KR Puram", "Yeshwanthpur",
]

# Posts whose titles contain any of these (case-insensitive) are rental listings, not discussions
LISTING_KEYWORDS = [
    "available", "for rent", "for lease", "looking for",
    "need flat", "need house", "need tenant", "bhk",
    "bachelor", "family only", "semi furnished", "fully furnished",
]

MAX_PER_LOCALITY = 5   # posts per locality per subreddit search
ALREADY_HAVE     = 5   # skip locality if >= this many reddit posts in last 24h


# ── Reddit OAuth ──────────────────────────────────────────────────────────────

def get_oauth_token() -> str | None:
    """Fetch an app-only OAuth token from Reddit (same as ingest_reddit.py)."""
    client_id     = os.getenv("REDDIT_CLIENT_ID", "")
    client_secret = os.getenv("REDDIT_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        logger.error("REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not set")
        return None
    try:
        resp = requests.post(
            "https://www.reddit.com/api/v1/access_token",
            auth=(client_id, client_secret),
            data={"grant_type": "client_credentials"},
            headers={"User-Agent": _UA},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()["access_token"]
    except Exception as e:
        logger.error("Reddit OAuth failed: %s", e)
        return None


# ── DB checks ─────────────────────────────────────────────────────────────────

def _already_covered(conn, locality: str) -> bool:
    """Return True if locality_feed already has >= ALREADY_HAVE reddit rows in the last 24 h."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT COUNT(*) FROM locality_feed
        WHERE source   = 'reddit'
          AND locality = %s
          AND scraped_at >= NOW() - INTERVAL '24 hours'
        """,
        (locality,),
    )
    return cur.fetchone()[0] >= ALREADY_HAVE


# ── Filtering ─────────────────────────────────────────────────────────────────

def _is_listing(title: str) -> bool:
    """Return True if the title looks like a rental listing (should be skipped)."""
    lower = title.lower()
    return any(kw in lower for kw in LISTING_KEYWORDS)


# ── API fetch ─────────────────────────────────────────────────────────────────

def search_subreddit_oauth(token: str, subreddit: str, locality: str) -> list[dict]:
    """Search one subreddit via Reddit OAuth API."""
    url = f"https://oauth.reddit.com/r/{subreddit}/search"
    params = {
        "q":           locality,
        "sort":        "top",
        "t":           "day",
        "limit":       MAX_PER_LOCALITY,
        "restrict_sr": "1",
    }
    headers = {"User-Agent": _UA, "Authorization": f"bearer {token}"}
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=15)
        if resp.status_code != 200:
            logger.warning(
                "  %s / r/%s: OAuth API %d — %s",
                locality, subreddit, resp.status_code, resp.text[:200],
            )
            return []
        return [item["data"] for item in resp.json().get("data", {}).get("children", [])]
    except Exception as e:
        logger.error("  %s / r/%s: OAuth request failed — %s", locality, subreddit, e)
        return []


def search_subreddit_public(subreddit: str, locality: str) -> list[dict]:
    """Fallback: search via Reddit's public .json endpoint (no auth required)."""
    url = f"https://www.reddit.com/r/{subreddit}/search.json"
    params = {
        "q":           locality,
        "sort":        "top",
        "t":           "day",
        "limit":       MAX_PER_LOCALITY,
        "restrict_sr": "on",
    }
    headers = {"User-Agent": _UA}
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=15)
        if resp.status_code != 200:
            logger.warning(
                "  %s / r/%s: public .json %d — %s",
                locality, subreddit, resp.status_code, resp.text[:200],
            )
            return []
        return [item["data"] for item in resp.json().get("data", {}).get("children", [])]
    except Exception as e:
        logger.error("  %s / r/%s: public request failed — %s", locality, subreddit, e)
        return []


def search_subreddit(token: str | None, subreddit: str, locality: str) -> list[dict]:
    """Search a subreddit — tries OAuth first, falls back to public .json."""
    if token:
        results = search_subreddit_oauth(token, subreddit, locality)
        if results:
            return results
        logger.info("  %s / r/%s: OAuth empty, trying public .json", locality, subreddit)
    return search_subreddit_public(subreddit, locality)


# ── DB insert ─────────────────────────────────────────────────────────────────

def insert_posts(conn, locality: str, posts: list[dict]) -> tuple[int, int]:
    """
    Insert valid discussion posts into locality_feed.
    Returns (inserted_count, duplicate_count).
    """
    inserted   = 0
    duplicates = 0
    cur        = conn.cursor()

    for post in posts:
        source_id  = str(post.get("id", "")).strip()
        title      = (post.get("title") or "").strip()
        selftext   = post.get("selftext") or ""
        permalink  = post.get("permalink", "")
        subreddit  = post.get("subreddit", "")
        score      = post.get("score", 0)
        created_utc = post.get("created_utc")

        if not source_id or not title:
            continue

        body      = selftext[:1000] if selftext.strip() else None
        url       = f"https://reddit.com{permalink}"
        author    = f"r/{subreddit}"
        posted_at = (
            datetime.fromtimestamp(created_utc, tz=timezone.utc)
            if created_utc else None
        )

        try:
            cur.execute(
                """
                INSERT INTO locality_feed
                    (source, source_id, locality, title, body, url,
                     author, engagement, posted_at, topic, sentiment, scraped_at)
                VALUES
                    ('reddit', %s, %s, %s, %s, %s,
                     %s, %s, %s, NULL, NULL, NOW())
                ON CONFLICT (source, source_id) DO NOTHING
                """,
                (source_id, locality, title, body, url, author, score, posted_at),
            )
            if cur.rowcount == 1:
                inserted += 1
                logger.info("  [+] %.70s", title)
            else:
                duplicates += 1
        except Exception as e:
            logger.error("  insert failed for %s — %s", source_id, e)
            conn.rollback()
            cur = conn.cursor()

    conn.commit()
    return inserted, duplicates


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    token = get_oauth_token()
    if not token:
        logger.warning("No Reddit OAuth token — falling back to public .json endpoint")

    conn = get_connection()

    localities_processed = 0
    total_fetched        = 0
    total_filtered       = 0
    total_inserted       = 0
    total_duplicates     = 0

    logger.info("Starting Reddit discussion scrape for %d localities", len(LOCALITIES))

    for locality in LOCALITIES:
        if _already_covered(conn, locality):
            logger.info("  %s: skipping — already have enough recent posts", locality)
            continue

        localities_processed += 1
        locality_posts: list[dict] = []

        for subreddit in SUBREDDITS:
            raw = search_subreddit(token, subreddit, locality)

            # Filter out rental listing posts and low-engagement posts
            discussions = [
                p for p in raw
                if not _is_listing(p.get("title", ""))
                and p.get("score", 0) >= MIN_SCORE
            ]
            filtered = len(raw) - len(discussions)

            total_fetched  += len(raw)
            total_filtered += filtered
            locality_posts.extend(discussions)

            logger.info(
                "  %s / r/%s: %d fetched, %d filtered (listings/low-score)",
                locality, subreddit, len(raw), filtered,
            )

            time.sleep(0.5)  # polite pause between subreddit calls

        inserted, dupes = insert_posts(conn, locality, locality_posts)
        total_inserted   += inserted
        total_duplicates += dupes

    conn.close()

    print(
        f"\nReddit discussion scrape complete.\n"
        f"Localities processed:     {localities_processed}\n"
        f"Posts fetched:            {total_fetched}\n"
        f"Listing posts filtered:   {total_filtered}\n"
        f"Posts inserted:           {total_inserted} "
        f"({total_duplicates} duplicates skipped)"
    )


if __name__ == "__main__":
    main()
