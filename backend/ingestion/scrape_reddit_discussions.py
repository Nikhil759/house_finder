#!/usr/bin/env python3
"""
Reddit discussion scraper for the NestIQ locality feed.

Two-tier scraping strategy:
  1. Locality subreddits — per-locality search across focused Bangalore subs
  2. City-level subreddits — single city-keyword search on high-volume subs
     (locality assignment is deferred to the Gemini tagger)

Inserts raw posts into locality_feed with category/topic = NULL.
The tag_locality_feed job classifies them afterward.

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

from ingestion.db import get_connection, record_run_start, record_run_end, UpsertStats

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("scrape_reddit_discussions")

# ── Constants ─────────────────────────────────────────────────────────────────

_UA = "python:nestiq-ingestion:v2.0 (by /u/nikhil7599)"

# Tier 1: Focused Bangalore subs — searched per-locality
# When OAuth is available, all subs are used. Without OAuth (public .json),
# only the core subs are used to stay within rate limits (~10 req/min).
CORE_SUBREDDITS = [
    "bangalore",
    "bengaluru",
    "indianrealestate",
]
EXTRA_SUBREDDITS = [
    "Whitefield",
    "indiranagar",
    "bangalorefoodies",
    "Bangalorestartups",
    "BangaloreRealEstates",
    "karnataka",
]

# Tier 2: High-volume subs — single city-keyword search (no per-locality loop)
CITY_LEVEL_SUBREDDITS = {
    "india":           "Bangalore OR Bengaluru",
    "developersIndia": "Bangalore OR Bengaluru (rent OR commute OR relocat OR traffic OR neighbourhood)",
}

MIN_SCORE = 3

LOCALITIES = [
    "Indiranagar", "Koramangala", "HSR Layout", "Whitefield",
    "Electronic City", "Hebbal", "Yelahanka", "BTM Layout",
    "JP Nagar", "Marathahalli", "Bellandur", "Jayanagar",
    "Malleshwaram", "Banashankari", "Hoodi", "Banaswadi",
    "HBR Layout", "Sarjapur Road", "KR Puram", "Yeshwanthpur",
]

LISTING_KEYWORDS = [
    "available", "for rent", "for lease", "looking for",
    "need flat", "need house", "need tenant", "bhk",
    "bachelor", "family only", "semi furnished", "fully furnished",
    "flatmate", "flat mate", "roommate", "room mate",
    "sharing basis", "single occupancy", "double sharing",
    "rent pm", "per month", "move in",
    "shifting", "relocating", "need pg", "need room",
    "dm me", "contact me", "whatsapp",
]

MAX_PER_SEARCH   = 15   # results per search call
CITY_LEVEL_LIMIT = 25   # results for city-level subreddit searches
ALREADY_HAVE     = 50   # skip locality if >= this many reddit posts in last 24h

# High-volume subs get both sort modes; smaller subs only get "top"
DUAL_SORT_SUBS = {"bangalore", "bengaluru", "indianrealestate"}

# Rate limiting — adaptive based on OAuth availability
SLEEP_WITH_OAUTH    = 0.5   # seconds (OAuth: ~60 req/min)
SLEEP_WITHOUT_OAUTH = 4.0   # seconds (public: ~10 req/min, with margin)
SLEEP_ON_429        = 15.0  # seconds (backoff on rate limit)
MAX_429_RETRIES     = 1     # retry once on 429, then skip


# ── Reddit OAuth ──────────────────────────────────────────────────────────────

def get_oauth_token() -> str | None:
    """Fetch an app-only OAuth token from Reddit."""
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
    """Return True if locality_feed already has >= ALREADY_HAVE reddit rows in the last 24h."""
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
    """Return True if the title looks like a rental listing (pre-filter before Gemini)."""
    lower = title.lower()
    return any(kw in lower for kw in LISTING_KEYWORDS)


# ── API fetch ─────────────────────────────────────────────────────────────────

def _search_oauth(token: str, subreddit: str, query: str,
                  sort: str, time_filter: str, limit: int) -> list[dict]:
    """Search one subreddit via Reddit OAuth API."""
    url = f"https://oauth.reddit.com/r/{subreddit}/search"
    params = {
        "q": query, "sort": sort, "t": time_filter,
        "limit": limit, "restrict_sr": "1",
    }
    headers = {"User-Agent": _UA, "Authorization": f"bearer {token}"}
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=15)
        if resp.status_code != 200:
            logger.warning("  r/%s: OAuth %d — %s", subreddit, resp.status_code, resp.text[:200])
            return []
        return [item["data"] for item in resp.json().get("data", {}).get("children", [])]
    except Exception as e:
        logger.error("  r/%s: OAuth request failed — %s", subreddit, e)
        return []


def _search_public(subreddit: str, query: str,
                   sort: str, time_filter: str, limit: int) -> list[dict]:
    """Fallback: search via Reddit's public .json endpoint using curl subprocess.

    Python's requests library TLS fingerprint is flagged by Reddit's bot
    detection; curl's native TLS stack is not, so we shell out to curl.
    """
    import json
    import subprocess
    import urllib.parse

    qs = urllib.parse.urlencode({
        "q": query, "sort": sort, "t": time_filter,
        "limit": limit, "restrict_sr": "on",
    })
    url = f"https://www.reddit.com/r/{subreddit}/search.json?{qs}"
    ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

    for attempt in range(1 + MAX_429_RETRIES):
        try:
            result = subprocess.run(
                [
                    "curl", "-s", "--max-time", "20",
                    "-H", f"User-Agent: {ua}",
                    "-H", "Accept: application/json",
                    "-H", "Accept-Language: en-US,en;q=0.9",
                    "-H", "Referer: https://www.reddit.com/",
                    "--write-out", "\n%{http_code}",
                    url,
                ],
                capture_output=True, text=True, timeout=25,
            )
            body, _, status_str = result.stdout.rpartition("\n")
            status_code = int(status_str.strip()) if status_str.strip().isdigit() else 0

            if status_code == 429:
                if attempt < MAX_429_RETRIES:
                    logger.warning("  r/%s: 429 rate limited — backing off %.0fs", subreddit, SLEEP_ON_429)
                    time.sleep(SLEEP_ON_429)
                    continue
                logger.warning("  r/%s: 429 after retry — skipping", subreddit)
                return []
            if status_code != 200:
                logger.warning("  r/%s: public .json %d", subreddit, status_code)
                return []

            data = json.loads(body)
            return [item["data"] for item in data.get("data", {}).get("children", [])]
        except Exception as e:
            logger.error("  r/%s: public request failed — %s", subreddit, e)
            return []
    return []


def search_subreddit(token: str | None, subreddit: str, query: str,
                     sort: str = "top", time_filter: str = "week",
                     limit: int = MAX_PER_SEARCH) -> list[dict]:
    """Search a subreddit — tries OAuth first, falls back to public .json."""
    if token:
        results = _search_oauth(token, subreddit, query, sort, time_filter, limit)
        if results:
            return results
    return _search_public(subreddit, query, sort, time_filter, limit)


# ── DB insert ─────────────────────────────────────────────────────────────────

def insert_posts(conn, locality: str | None, posts: list[dict]) -> tuple[int, int]:
    """
    Insert posts into locality_feed.
    locality can be None for city-level posts (Gemini assigns later).
    Returns (inserted_count, duplicate_count).
    """
    inserted   = 0
    duplicates = 0
    cur        = conn.cursor()

    for post in posts:
        source_id   = str(post.get("id", "")).strip()
        title       = (post.get("title") or "").strip()
        selftext    = post.get("selftext") or ""
        permalink   = post.get("permalink", "")
        subreddit   = post.get("subreddit", "")
        score       = post.get("score", 0)
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
                     author, engagement, posted_at, scraped_at)
                VALUES
                    ('reddit', %s, %s, %s, %s, %s,
                     %s, %s, %s, NOW())
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
    from datetime import datetime, timezone
    started_at = datetime.now(timezone.utc)
    db_run_id  = record_run_start("reddit_discussions")

    token = get_oauth_token()
    has_oauth = token is not None

    if has_oauth:
        locality_subreddits = CORE_SUBREDDITS + EXTRA_SUBREDDITS
        sleep_interval = SLEEP_WITH_OAUTH
        logger.info("Using OAuth — all %d subreddits, %.1fs sleep", len(locality_subreddits), sleep_interval)
    else:
        locality_subreddits = CORE_SUBREDDITS
        sleep_interval = SLEEP_WITHOUT_OAUTH
        logger.warning(
            "No OAuth token — using %d core subreddits only, %.1fs sleep (public rate limit)",
            len(locality_subreddits), sleep_interval,
        )

    conn = get_connection()

    total_fetched    = 0
    total_filtered   = 0
    total_inserted   = 0
    total_duplicates = 0

    # ── Tier 1: Per-locality search across focused subs ───────────────────
    logger.info(
        "Tier 1: Searching %d localities across %d subreddits",
        len(LOCALITIES), len(locality_subreddits),
    )

    for locality in LOCALITIES:
        if _already_covered(conn, locality):
            logger.info("  %s: skipping — already have enough recent posts", locality)
            continue

        locality_posts: list[dict] = []
        seen_ids: set[str] = set()

        for subreddit in locality_subreddits:
            sort_modes = ["top", "new"] if subreddit.lower() in DUAL_SORT_SUBS else ["top"]

            for sort_mode in sort_modes:
                raw = search_subreddit(
                    token, subreddit, locality,
                    sort=sort_mode, time_filter="week",
                    limit=MAX_PER_SEARCH,
                )

                discussions = [
                    p for p in raw
                    if not _is_listing(p.get("title", ""))
                    and p.get("score", 0) >= MIN_SCORE
                    and str(p.get("id", "")) not in seen_ids
                ]
                for p in discussions:
                    seen_ids.add(str(p.get("id", "")))

                filtered = len(raw) - len(discussions)
                total_fetched  += len(raw)
                total_filtered += filtered
                locality_posts.extend(discussions)

                time.sleep(sleep_interval)

        inserted, dupes = insert_posts(conn, locality, locality_posts)
        total_inserted   += inserted
        total_duplicates += dupes
        logger.info("  %s: %d inserted, %d duplicates", locality, inserted, dupes)

    # ── Tier 2: City-level search on high-volume subs ─────────────────────
    logger.info(
        "Tier 2: City-level search across %d high-volume subreddits",
        len(CITY_LEVEL_SUBREDDITS),
    )

    for subreddit, query in CITY_LEVEL_SUBREDDITS.items():
        for sort_mode in ["top", "new"]:
            raw = search_subreddit(
                token, subreddit, query,
                sort=sort_mode, time_filter="week",
                limit=CITY_LEVEL_LIMIT,
            )

            discussions = [
                p for p in raw
                if not _is_listing(p.get("title", ""))
                and p.get("score", 0) >= MIN_SCORE
            ]
            filtered = len(raw) - len(discussions)
            total_fetched  += len(raw)
            total_filtered += filtered

            inserted, dupes = insert_posts(conn, None, discussions)
            total_inserted   += inserted
            total_duplicates += dupes

            logger.info(
                "  r/%s (sort=%s): %d fetched, %d filtered, %d inserted",
                subreddit, sort_mode, len(raw), filtered, inserted,
            )

            time.sleep(sleep_interval)

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
        f"\nReddit discussion scrape complete.\n"
        f"Posts fetched:            {total_fetched}\n"
        f"Listing posts filtered:  {total_filtered}\n"
        f"Posts inserted:           {total_inserted} "
        f"({total_duplicates} duplicates skipped)"
    )

    if total_inserted > 0:
        from transforms.fast_path import run_post_pulse_transforms
        run_post_pulse_transforms("reddit_discussions")

    from sync.trigger import trigger_sync_after_completion
    trigger_sync_after_completion(reason="scrape_reddit_discussions")


if __name__ == "__main__":
    main()
