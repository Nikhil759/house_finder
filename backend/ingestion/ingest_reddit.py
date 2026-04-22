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
    upsert_listings, record_run_start, record_run_end, UpsertStats,
)
from localities import extract_locality, LOCALITY_META, LOCALITY_ALIASES

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ingest_reddit")

GOOGLE_API_KEY: str = os.environ.get("GOOGLE_PLACES_API_KEY", "")
_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"

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

def _resolve_geocode(
    address: str | None, locality: str | None
) -> tuple[float, float, str, str] | None:
    """
    Try geocoding in priority order.
    Returns (lat, lng, geocode_source, geocode_confidence) or None.
    """
    # Step 1 — address geocode via Google API
    if address and address.strip() and GOOGLE_API_KEY:
        query = f"{address.strip()}, Bangalore"
        try:
            resp = requests.get(
                _GEOCODE_URL,
                params={"address": query, "key": GOOGLE_API_KEY, "region": "in"},
                timeout=8,
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("status") == "OK" and data.get("results"):
                loc = data["results"][0]["geometry"]["location"]
                return float(loc["lat"]), float(loc["lng"]), "address_geocode", "medium"
        except Exception as exc:
            logger.debug("Geocode API error for %r: %s", address, exc)

    # Step 2 — locality centroid fallback
    if locality:
        meta = LOCALITY_META.get(locality)
        if not meta:
            canonical = LOCALITY_ALIASES.get(locality.strip().lower())
            if canonical:
                meta = LOCALITY_META.get(canonical)
        if meta:
            lat, lng = meta["coords"]
            return float(lat), float(lng), "locality_centroid", "low"

    return None


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
    """Fetch via Reddit's public .json endpoint using curl subprocess.

    Python's requests library TLS fingerprint is flagged by Reddit's bot
    detection; curl's native TLS stack is not, so we shell out to curl.
    """
    import json
    import subprocess
    import urllib.parse

    query = urllib.parse.urlencode({
        "q": "bangalore rent OR bhk OR flat OR room OR pg OR flatmate",
        "sort": "new",
        "limit": limit,
        "t": "month",
        "restrict_sr": "on",
    })
    url = f"https://www.reddit.com/r/{_SUBREDDIT_STR}/search.json?{query}"
    ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    try:
        result = subprocess.run(
            [
                "curl", "-s", "--max-time", "20",
                "-H", f"User-Agent: {ua}",
                "-H", "Accept: application/json",
                "-H", "Accept-Language: en-US,en;q=0.9",
                "-H", "Referer: https://www.reddit.com/",
                url,
            ],
            capture_output=True, text=True, timeout=25,
        )
        data = json.loads(result.stdout)
        posts = [item["data"] for item in data.get("data", {}).get("children", [])]
        return posts
    except Exception as e:
        logger.error("Public Reddit .json fetch failed: %s", e)
        return []


def fetch_via_pullpush(limit: int = 100) -> list[dict]:
    """Fallback: fetch via PullPush.io (no auth required).
    PullPush only accepts one subreddit per request, so we loop.
    """
    after = int(time.time()) - 30 * 86400
    per_sub = max(10, min(limit // len(SUBREDDITS), 100))
    results: list[dict] = []

    for subreddit in SUBREDDITS:
        params = {
            "q": "bangalore rent bhk",
            "subreddit": subreddit,
            "size": per_sub,
            "sort": "desc", "sort_type": "created_utc",
            "after": after,
        }
        try:
            resp = requests.get(
                PULLPUSH_URL, headers={"User-Agent": _UA},
                params=params, timeout=10,
            )
            resp.raise_for_status()
            results.extend(resp.json().get("data", []))
        except Exception as e:
            logger.warning("PullPush fetch failed for r/%s: %s", subreddit, e)

    return results


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

    # Geocode listings that still have no coordinates after upsert
    _needs_geocode = [l for l in all_listings if l.latitude is None]
    if _needs_geocode:
        from ingestion.db import get_connection
        import psycopg2.extras
        _geo_updates: list[tuple] = []
        for listing in _needs_geocode:
            result = _resolve_geocode(listing.address, listing.locality)
            if result:
                lat, lng, geo_src, geo_conf = result
                _geo_updates.append((lat, lng, geo_src, geo_conf,
                                     listing.source, listing.source_id))
        if _geo_updates:
            _conn = get_connection()
            try:
                _cur = _conn.cursor()
                psycopg2.extras.execute_batch(
                    _cur,
                    """UPDATE listings SET
                           latitude           = %s,
                           longitude          = %s,
                           geocode_source     = %s,
                           geocode_confidence = %s
                       WHERE source = %s AND source_id = %s
                         AND latitude IS NULL""",
                    _geo_updates,
                )
                _conn.commit()
                logger.info("Geocoded %d/%d Reddit listings (%d unresolved)",
                            len(_geo_updates), len(_needs_geocode),
                            len(_needs_geocode) - len(_geo_updates))
            finally:
                _conn.close()

    final_status = "success" if (stats.total_errors == 0 and len(all_listings) > 0) else "partial"
    record_run_end(
        db_run_id,
        status=final_status,
        stats=stats,
        total_fetched=len(all_listings),
        error_message=None if final_status == "success" else f"{stats.total_errors} errors, {len(all_listings)} fetched",
        started_at=started_at,
    )
    logger.info(
        "Reddit ingestion complete: %d fetched, %d new, %d updated",
        len(all_listings), stats.total_new, stats.total_updated,
    )

    if stats.total_new + stats.total_updated > 0:
        from transforms.fast_path import run_post_ingest_transforms
        run_post_ingest_transforms("reddit", started_at)


if __name__ == "__main__":
    main()
