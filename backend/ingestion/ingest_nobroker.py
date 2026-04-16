#!/usr/bin/env python3
"""
NoBroker ingestion script.

Fetches rental listings from the NoBroker REST API for all active
localities, normalizes to StandardListing, and upserts to Supabase Postgres.

Usage:
    python -m ingestion.ingest_nobroker          # from backend/
    python backend/ingestion/ingest_nobroker.py  # from repo root
"""

from __future__ import annotations

import base64
import json
import logging
import os
import random
import re
import sys
import time
from datetime import datetime, timezone

# Allow running from repo root or backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from ingestion.models import StandardListing
from ingestion.db import (
    upsert_listings, record_run_start, record_run_end, UpsertStats,
)
from localities import extract_locality

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ingest_nobroker")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Referer": "https://www.nobroker.in/",
}

BASE_URL = "https://www.nobroker.in/api/v3/multi/property/RENT/filter"


def get_active_localities() -> list[dict]:
    """Fetch active localities from the DB, falling back to localities.py."""
    try:
        from ingestion.db import get_connection
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT name, latitude, longitude FROM localities WHERE is_active = TRUE"
        )
        rows = cur.fetchall()
        conn.close()
        if rows:
            return [{"name": r[0], "lat": r[1], "lon": r[2]} for r in rows]
    except Exception as e:
        logger.warning("Could not load localities from DB, using fallback: %s", e)

    from localities import get_nobroker_localities
    return get_nobroker_localities()


def build_search_param(lat: float, lon: float, place_name: str) -> str:
    payload = [{"lat": lat, "lon": lon, "placeName": place_name}]
    return base64.b64encode(json.dumps(payload).encode()).decode()


def fetch_locality(locality: dict, page: int = 1, limit: int = 30) -> list[dict]:
    """Fetch raw listings for one locality from the NoBroker API."""
    import requests
    search_param = build_search_param(locality["lat"], locality["lon"], locality["name"])
    params = {
        "city": "bangalore",
        "isMetro": "false",
        "isScheduleVisitPropertyFilter": "false",
        "locality": locality["name"],
        "pageNo": page,
        "radius": "2.0",
        "searchParam": search_param,
        "sharedAccomodation": "0",
    }
    try:
        resp = requests.get(BASE_URL, params=params, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") == "success":
            return data.get("data", [])
        return []
    except Exception as e:
        logger.error("Fetch failed for %s: %s", locality["name"], e)
        return []


def normalize(item: dict, locality_name: str) -> StandardListing:
    """Convert a raw NoBroker API item to StandardListing."""
    furnishing_raw = item.get("furnishing", "")
    detail_url = f"https://www.nobroker.in{item.get('detailUrl', '')}"

    created_ts = item.get("activationDate", 0)
    if created_ts:
        created_ts = created_ts / 1000

    amenities_map = item.get("amenitiesMap", {})
    amenity_labels = []
    if amenities_map.get("GYM"):      amenity_labels.append("Gym")
    if amenities_map.get("POOL"):     amenity_labels.append("Pool")
    if amenities_map.get("SECURITY"): amenity_labels.append("Security")
    if amenities_map.get("LIFT"):     amenity_labels.append("Lift")
    if amenities_map.get("PARK"):     amenity_labels.append("Parking")

    raw_locality = (item.get("locality") or locality_name).strip()
    canonical_locality = extract_locality(raw_locality) or raw_locality

    body_text = " | ".join(filter(None, [
        item.get("typeDesc", ""),
        f"{item.get('propertySize', '')} sqft" if item.get("propertySize") else "",
        furnishing_raw,
        item.get("address", ""),
        item.get("ownerDescription", ""),
    ]))

    # society_name: prefer buildingName, fall back to society; strip locality suffix
    _society_raw = (item.get("buildingName") or item.get("society") or "").strip()
    society_name = re.split(r"\s*,\s*", _society_raw)[0].strip() or None

    # image_urls: build from photos[].imagesMap.large using confirmed URL pattern
    _property_id = str(item.get("id", ""))
    _nb_base = "https://assets.nobroker.in/images"
    image_urls: list[str] = []
    for photo in (item.get("photos") or [])[:10]:
        if not isinstance(photo, dict):
            continue
        filename = (photo.get("imagesMap") or {}).get("large") or \
                   (photo.get("imagesMap") or {}).get("original") or \
                   (photo.get("imagesMap") or {}).get("medium") or ""
        if filename and _property_id:
            image_urls.append(f"{_nb_base}/{_property_id}/{filename}")

    listing = StandardListing(
        source="nobroker",
        source_id=_property_id,
        source_url=detail_url,
        title=item.get("title") or item.get("propertyTitle", ""),
        body=body_text,
        bhk=item.get("typeDesc"),
        property_type="Apartment",
        furnishing=furnishing_raw,
        rent=item.get("rent"),
        deposit=item.get("deposit"),
        locality=canonical_locality,
        address=item.get("address", ""),
        latitude=item.get("latitude"),
        longitude=item.get("longitude"),
        area_sqft=item.get("propertySize"),
        amenities=amenity_labels,
        lease_type=item.get("leaseType"),
        contact_name=item.get("ownerName"),
        is_sponsored=item.get("sponsored", False),
        thumbnail_url=item.get("thumbnailImage"),
        posted_at=created_ts if created_ts else None,
        raw_payload=item,
        society_name=society_name,
        image_urls=image_urls,
    )
    return listing


def main():
    started_at = datetime.now(timezone.utc)
    run_id = os.environ.get("GITHUB_RUN_ID")
    db_run_id = record_run_start("nobroker", run_id)

    localities = get_active_localities()
    logger.info("Starting NoBroker ingestion for %d localities", len(localities))

    all_listings: list[StandardListing] = []
    locality_counts: dict[str, int] = {}
    total_errors = 0

    for locality in localities:
        name = locality["name"]
        try:
            raw_items = fetch_locality(locality)
            normalized = [normalize(item, name) for item in raw_items]
            all_listings.extend(normalized)
            locality_counts[name] = len(normalized)
            logger.info("  %s: %d listings", name, len(normalized))
            time.sleep(random.uniform(2, 4))
        except Exception as e:
            logger.error("  %s: FAILED — %s", name, e)
            total_errors += 1

    stats = UpsertStats()
    if all_listings:
        stats = upsert_listings(all_listings)

    record_run_end(
        db_run_id,
        status="success" if total_errors == 0 else "partial",
        stats=stats,
        total_fetched=len(all_listings),
        locality_counts=locality_counts,
        error_message=None if total_errors == 0 else f"{total_errors} locality fetches failed",
        started_at=started_at,
    )
    logger.info(
        "NoBroker ingestion complete: %d fetched, %d new, %d updated, %d stale",
        len(all_listings), stats.total_new, stats.total_updated, stale_count,
    )


if __name__ == "__main__":
    main()
