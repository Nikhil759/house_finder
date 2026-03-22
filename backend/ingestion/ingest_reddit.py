#!/usr/bin/env python3
"""
Reddit ingestion script.

Fetches rental listing posts from Bangalore-related subreddits via
the Reddit OAuth API, normalizes to StandardListing, and upserts to
Supabase Postgres.

Usage:
    python -m ingestion.ingest_reddit          # from backend/
    python backend/ingestion/ingest_reddit.py  # from repo root
"""

from __future__ import annotations

import logging
import os
import re
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import requests

from ingestion.models import StandardListing
from ingestion.db import (
    upsert_listings, mark_stale, record_run_start, record_run_end, UpsertStats,
)
from ingestion.scoring import compute_quality_score
from localities import extract_locality

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ingest_reddit")

SUBREDDITS = [
    "bangalore", "bengaluru", "indianrealestate",
    "bangalorerentals", "FlatandFlatmatesBLR", "FlatmatesinBangalore",
]
_SUBREDDIT_STR = "+".join(SUBREDDITS)
SEARCH_URL_OAUTH = f"https://oauth.reddit.com/r/{_SUBREDDIT_STR}/search"
PULLPUSH_URL = "https://api.pullpush.io/reddit/search/submission/"

_UA = "python:nestiq-ingestion:v2.0 (by /u/nikhil7599)"

LISTING_KEYWORDS = [
    "rent", "bhk", "pg", "flatmate", "room for",
    "available", "deposit", "furnished", "lease",
    "tenant", "flat for", "looking for",
]

# ── Reddit OAuth ──

def get_oauth_token() -> str | None:
    """Fetch an app-only OAuth token from Reddit."""
    client_id = os.getenv("REDDIT_CLIENT_ID", "")
    client_secret = os.getenv("REDDIT_CLIENT_SECRET", "")
    if not client_id or not client_secret:
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


# ── Fetching ──

def fetch_via_oauth(token: str, limit: int = 100) -> list[dict]:
    """Fetch posts via Reddit OAuth API."""
    params = {
        "q": "bangalore rent OR bhk OR flat OR room OR pg OR flatmate",
        "sort": "new", "limit": limit, "t": "month", "restrict_sr": "1",
    }
    headers = {"User-Agent": _UA, "Authorization": f"bearer {token}"}
    try:
        resp = requests.get(SEARCH_URL_OAUTH, headers=headers, params=params, timeout=15)
        resp.raise_for_status()
        return [item["data"] for item in resp.json().get("data", {}).get("children", [])]
    except Exception as e:
        logger.error("Reddit OAuth fetch failed: %s", e)
        return []


def fetch_via_public_json(limit: int = 100) -> list[dict]:
    """Fetch via Reddit's public .json endpoint with browser-like session."""
    import random
    user_agents = [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ]
    session = requests.Session()
    headers = {
        "User-Agent": random.choice(user_agents),
        "Accept": "application/json", "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.reddit.com/", "DNT": "1",
    }
    try:
        session.get("https://www.reddit.com/", headers=headers, timeout=10)
        time.sleep(random.uniform(0.5, 1.5))
    except Exception:
        pass

    url = f"https://www.reddit.com/r/{_SUBREDDIT_STR}/search.json"
    params = {
        "q": "bangalore rent OR bhk OR flat OR room OR pg OR flatmate",
        "sort": "new", "limit": limit, "t": "month", "restrict_sr": "on",
    }
    try:
        resp = session.get(url, params=params, headers=headers, timeout=15)
        resp.raise_for_status()
        return [item["data"] for item in resp.json().get("data", {}).get("children", [])]
    except Exception as e:
        logger.error("Public Reddit .json fetch failed: %s", e)
        return []


def fetch_via_pullpush(limit: int = 100) -> list[dict]:
    """Fallback: fetch via PullPush.io (no auth required)."""
    params = {
        "q": "bangalore rent bhk",
        "subreddit": ",".join(SUBREDDITS),
        "size": min(limit, 100),
        "sort": "desc", "sort_type": "created_utc",
        "after": int(time.time()) - 30 * 86400,
    }
    try:
        resp = requests.get(PULLPUSH_URL, headers={"User-Agent": _UA}, params=params, timeout=15)
        resp.raise_for_status()
        return resp.json().get("data", [])
    except Exception as e:
        logger.error("PullPush fetch failed: %s", e)
        return []


# ── Parsing helpers ──

def _extract_price(text: str) -> int | None:
    for pat in [r"₹\s?([\d,]+)", r"rs\.?\s?([\d,]+)", r"([\d,]+)\s?(?:per month|/month|pm|k/month)"]:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            try:
                val = int(m.group(1).replace(",", ""))
                if val < 500:
                    val *= 1000
                return val if val > 0 else None
            except ValueError:
                pass
    return None


def _extract_contact(text: str) -> str | None:
    m = re.search(r"(?:\+?91[\s-]?)?([6-9]\d{9})", text)
    return m.group(1) if m else None


def _extract_bhk(text: str) -> str | None:
    m = re.search(r"(\d)\s*(?:BHK|bhk|bedroom)", text, re.IGNORECASE)
    if m:
        return f"{m.group(1)} BHK"
    if re.search(r"studio|1\s*rk", text, re.IGNORECASE):
        return "Studio/1RK"
    return None


def _extract_furnishing(text: str) -> str | None:
    if re.search(r"fully[\s-]furnished", text, re.IGNORECASE):
        return "Fully Furnished"
    if re.search(r"semi[\s-]furnished", text, re.IGNORECASE):
        return "Semi Furnished"
    if re.search(r"unfurnished|un-furnished", text, re.IGNORECASE):
        return "Unfurnished"
    return None


def _is_listing(post: dict) -> bool:
    """Filter out non-listing posts (questions, memes, etc.)."""
    text = f"{post.get('title', '')} {post.get('selftext', '')}".lower()
    return any(kw in text for kw in LISTING_KEYWORDS)


def _is_flatmate(text: str) -> bool:
    return bool(re.search(
        r"flatmate|flat.?mate|roommate|room.?mate|single room|sharing", text, re.IGNORECASE
    ))


# ── Normalizer ──

def normalize(p: dict) -> StandardListing:
    """Convert a raw Reddit post dict to StandardListing."""
    text = f"{p.get('title', '')} {p.get('selftext', '')}"
    permalink = p.get("permalink", "")
    url = permalink if permalink.startswith("http") else f"https://reddit.com{permalink}"

    rent = _extract_price(text)
    contact = _extract_contact(text)
    bhk = _extract_bhk(text)
    furnishing = _extract_furnishing(text)
    locality = extract_locality(text)
    flatmate = _is_flatmate(text)

    listing = StandardListing(
        source="reddit",
        source_id=str(p.get("id", "")),
        source_url=url,
        source_group=p.get("subreddit", ""),
        title=p.get("title", ""),
        body=p.get("selftext", "")[:2000],
        bhk=bhk,
        property_type="Flatmate" if flatmate else None,
        furnishing=furnishing,
        rent=rent,
        locality=locality,
        contact_phone=contact,
        is_flatmate=flatmate,
        posted_at=p.get("created_utc", 0),
        raw_payload=p,
    )
    listing.quality_score = compute_quality_score(
        source="reddit",
        title=listing.title or "",
        body=listing.body or "",
        rent=listing.rent,
        contact_phone=listing.contact_phone,
        bhk=listing.bhk,
        furnishing=listing.furnishing,
        posted_at=listing.posted_at,
        reddit_score=p.get("score", 0),
        reddit_comments=p.get("num_comments", 0),
    )
    return listing


def main():
    started_at = datetime.now(timezone.utc)
    run_id = os.environ.get("GITHUB_RUN_ID")
    db_run_id = record_run_start("reddit", run_id)

    logger.info("Starting Reddit ingestion")

    raw_posts: list[dict] = []

    # Tier 1: OAuth API
    token = get_oauth_token()
    if token:
        raw_posts = fetch_via_oauth(token)
        if raw_posts:
            logger.info("Fetched %d posts via OAuth", len(raw_posts))

    # Tier 2: Public Reddit .json (browser-like session)
    if not raw_posts:
        logger.info("OAuth unavailable or empty, trying public .json")
        raw_posts = fetch_via_public_json()
        if raw_posts:
            logger.info("Fetched %d posts via public .json", len(raw_posts))

    # Tier 3: PullPush fallback
    if not raw_posts:
        logger.info("Public .json failed, trying PullPush")
        raw_posts = fetch_via_pullpush()
        if raw_posts:
            logger.info("Fetched %d posts via PullPush", len(raw_posts))

    if not raw_posts:
        logger.warning("No posts fetched from any source")
        record_run_end(db_run_id, status="failed", error_message="No posts fetched", started_at=started_at)
        return

    # Filter to actual listings
    raw_posts = [p for p in raw_posts if _is_listing(p)]
    logger.info("After filtering: %d listing posts", len(raw_posts))

    all_listings = [normalize(p) for p in raw_posts]

    stats = UpsertStats()
    if all_listings:
        stats = upsert_listings(all_listings)

    stale_count = mark_stale("reddit", started_at)

    record_run_end(
        db_run_id,
        status="success",
        stats=stats,
        total_fetched=len(all_listings),
        total_stale=stale_count,
        started_at=started_at,
    )
    logger.info(
        "Reddit ingestion complete: %d fetched, %d new, %d updated, %d stale",
        len(all_listings), stats.total_new, stats.total_updated, stale_count,
    )


if __name__ == "__main__":
    main()
