#!/usr/bin/env python3
"""
Reddit ingestion script — runs locally (residential IP) and writes to Postgres/SQLite.

Usage:
    python scripts/ingest_reddit.py

Set DATABASE_URL env var to write to Railway Postgres, or leave unset for local SQLite.
Designed to be run via cron every 6 hours:
    0 */6 * * * cd /path/to/reddit-housing && /path/to/python scripts/ingest_reddit.py >> logs/reddit_ingest.log 2>&1
"""

import os
import re
import sys
import json
import time
import random
import logging

import requests

# Add backend/ to path so we can import our modules
BACKEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend")
sys.path.insert(0, BACKEND_DIR)

from dotenv import load_dotenv
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from localities import LOCALITY_META, extract_locality, get_all_locality_names_lower
from listing_store import init_listings_table, upsert_listings_batch

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────

SUBREDDITS = [
    "bangalore", "bengaluru", "indianrealestate",
    "bangalorerentals", "FlatandFlatmatesBLR", "FlatmatesinBangalore",
]
SUBREDDIT_STR = "+".join(SUBREDDITS)

REDDIT_TTL_SECONDS = 7 * 3600  # 7 hours (run every 6h, overlap for safety)

INGESTION_LOCALITIES = [
    "Whitefield", "HSR Layout", "Koramangala", "Indiranagar", "Marathahalli",
    "Bellandur", "BTM Layout", "Hebbal", "Electronic City", "Sarjapur Road",
    "Hoodi", "Yelahanka", "Jayanagar", "JP Nagar", "Banashankari",
]

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
]

LISTING_KEYWORDS = [
    "rent", "rental", "pg", "flatmate", "flat", "bhk", "room",
    "available", "tenant", "lease", "hostel", "studio", "deposit",
    "furnished", "unfurnished", "sharing", "accommodation", "1rk",
]

BANGALORE_AREAS = list(get_all_locality_names_lower())


# ─────────────────────────────────────────────
# Reddit fetch
# ─────────────────────────────────────────────

def _get_headers():
    return {
        "User-Agent":      random.choice(USER_AGENTS),
        "Accept":          "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer":         "https://www.reddit.com/",
        "Origin":          "https://www.reddit.com",
        "DNT":             "1",
        "Connection":      "keep-alive",
    }


def fetch_reddit_search(query, limit=50, retries=2):
    """
    Hit Reddit's public search JSON endpoint using a browser-like session.
    Returns list of raw post dicts.
    """
    session = requests.Session()

    try:
        session.get("https://www.reddit.com/", headers=_get_headers(), timeout=10)
        time.sleep(random.uniform(0.5, 1.5))
    except Exception:
        pass

    url = f"https://www.reddit.com/r/{SUBREDDIT_STR}/search.json"
    params = {
        "q": query,
        "sort": "new",
        "limit": limit,
        "t": "month",
        "restrict_sr": "on",
    }

    for attempt in range(retries):
        try:
            resp = session.get(url, params=params, headers=_get_headers(), timeout=15)
            if resp.status_code == 403:
                logger.warning(f"Reddit 403 on attempt {attempt + 1}")
                time.sleep(random.uniform(3, 6))
                continue
            resp.raise_for_status()
            children = resp.json().get("data", {}).get("children", [])
            return [c["data"] for c in children]
        except requests.exceptions.HTTPError:
            logger.warning(f"Reddit HTTP error on attempt {attempt + 1}")
            time.sleep(random.uniform(3, 6))
        except Exception as e:
            logger.error(f"Reddit fetch error: {e}")
            time.sleep(random.uniform(2, 4))

    return []


# ─────────────────────────────────────────────
# Normalization
# ─────────────────────────────────────────────

def extract_price(text):
    patterns = [
        r"₹\s?[\d,]+",
        r"rs\.?\s?[\d,]+",
        r"[\d,]+\s?(?:per month|/month|pm|k/month)",
    ]
    for pat in patterns:
        match = re.search(pat, text, re.IGNORECASE)
        if match:
            return match.group(0).strip()
    return None


def extract_contact(text):
    match = re.search(r"(?:\+91[\s-]?)?[6-9]\d{9}", text)
    return match.group(0) if match else None


def is_listing(text):
    lower = text.lower()
    return any(kw in lower for kw in LISTING_KEYWORDS)


def normalize_reddit_post(raw):
    """Convert raw Reddit API post to our standard listing format."""
    text = raw.get("title", "") + " " + raw.get("selftext", "")
    permalink = raw.get("permalink", "")
    url = permalink if permalink.startswith("http") else f"https://reddit.com{permalink}"

    return {
        "id":        raw.get("id"),
        "source":    "reddit",
        "title":     raw.get("title", ""),
        "subreddit": raw.get("subreddit", ""),
        "author":    raw.get("author", "[deleted]"),
        "url":       url,
        "selftext":  raw.get("selftext", "")[:500],
        "score":     raw.get("score", 0),
        "comments":  raw.get("num_comments", 0),
        "created":   raw.get("created_utc", 0),
        "flair":     raw.get("link_flair_text") or "",
        "price":     extract_price(text),
        "contact":   extract_contact(text),
        "locality":  extract_locality(text),
    }


# ─────────────────────────────────────────────
# Build queries
# ─────────────────────────────────────────────

def build_broad_query():
    return (
        "Bangalore "
        "(rent OR rental OR PG OR flatmate OR \"for rent\" OR \"to let\" "
        "OR \"room available\" OR \"flat available\")"
    )


def build_locality_query(locality_name):
    return f"Bangalore rent {locality_name}"


# ─────────────────────────────────────────────
# Main ingestion
# ─────────────────────────────────────────────

def run_ingestion():
    logger.info("=" * 60)
    logger.info("Reddit ingestion started")
    logger.info(f"Localities: {len(INGESTION_LOCALITIES)}")
    logger.info(f"Subreddits: {SUBREDDIT_STR}")

    init_listings_table()

    all_posts = {}  # {post_id: normalized_post} for deduplication
    total_raw = 0

    # 1. Broad Bangalore query
    logger.info("Fetching broad Bangalore query...")
    broad_query = build_broad_query()
    raw_posts = fetch_reddit_search(broad_query, limit=100)
    total_raw += len(raw_posts)
    logger.info(f"  Broad query: {len(raw_posts)} raw posts")

    for raw in raw_posts:
        text = raw.get("title", "") + " " + raw.get("selftext", "")
        if is_listing(text):
            post = normalize_reddit_post(raw)
            all_posts[post["id"]] = post

    time.sleep(random.uniform(3, 5))

    # 2. Per-locality queries
    for i, locality in enumerate(INGESTION_LOCALITIES):
        logger.info(f"Fetching [{i+1}/{len(INGESTION_LOCALITIES)}] {locality}...")
        query = build_locality_query(locality)
        raw_posts = fetch_reddit_search(query, limit=50)
        total_raw += len(raw_posts)

        new_count = 0
        for raw in raw_posts:
            text = raw.get("title", "") + " " + raw.get("selftext", "")
            if is_listing(text):
                post = normalize_reddit_post(raw)
                if post["id"] not in all_posts:
                    new_count += 1
                all_posts[post["id"]] = post

        logger.info(f"  {locality}: {len(raw_posts)} raw, {new_count} new unique")
        delay = random.uniform(3, 5)
        time.sleep(delay)

    # 3. Upsert to DB
    listings = list(all_posts.values())
    logger.info(f"Total unique listings: {len(listings)} (from {total_raw} raw)")

    if listings:
        upsert_listings_batch(listings, ttl_seconds=REDDIT_TTL_SECONDS)
        logger.info(f"Upserted {len(listings)} Reddit listings to DB")

        # Stats
        with_locality = sum(1 for p in listings if p.get("locality"))
        locality_counts = {}
        for p in listings:
            loc = p.get("locality") or "Unknown"
            locality_counts[loc] = locality_counts.get(loc, 0) + 1

        logger.info(f"  With locality: {with_locality}/{len(listings)}")
        for loc, count in sorted(locality_counts.items(), key=lambda x: -x[1])[:10]:
            logger.info(f"    {loc}: {count}")
    else:
        logger.warning("No listings fetched — check if Reddit is blocking")

    logger.info("Reddit ingestion complete")
    logger.info("=" * 60)
    return len(listings)


if __name__ == "__main__":
    run_ingestion()
