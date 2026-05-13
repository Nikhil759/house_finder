#!/usr/bin/env python3
"""
Colive PG ingestion script.

Fetches PG/co-living listings from Colive's internal search API and upserts
them into the listings table via the shared db.py layer.

Usage:
    python -m ingestion.ingest_colive               # production run
    python -m ingestion.ingest_colive --dry-run      # fetch + parse, zero DB writes

Environment:
    SUPABASE_DB_URL  — Supabase Postgres connection string (required)
    GITHUB_RUN_ID    — set automatically by GitHub Actions (optional)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timezone

import requests

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
logger = logging.getLogger("ingest_colive")

# ── Constants ────────────────────────────────────────────────────────────────

SOURCE = "colive"
API_URL = "https://www.colive.com/api/Colive/GetPropertySearchDetails_Upgraded"

_HEADERS = {
    "content-type": "application/json",
    "accept": "application/json, text/plain, */*",
    "origin": "https://www.colive.com",
    "referer": "https://www.colive.com/colive/pg-in-bangalore",
    "user-agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/127.0.0.0 Safari/537.36"
    ),
}

_OCCUPANCY_MAP = {
    "3s": "triple",
    "twin": "double",
    "single": "single",
    "couple": "couple",
}


# ── Fetch ────────────────────────────────────────────────────────────────────

def _build_request_body() -> dict:
    today = datetime.now().strftime("%d-%b-%Y")
    return {
        "Date": today,
        "Distance": "",
        "FurnishStatusIds": "",
        "Latitude": "",
        "LocationName": "pg-in-bangalore",
        "Longitude": "",
        "MaxValue": "",
        "MinValue": "",
        "OfferId": 0,
        "PropertyModelTypes": "1",
        "PropertyVariantsIds": "",
        "RoomClassIds": "",
        "RoomShareCategory": "",
        "RoomSubTypeIds": "",
        "RoomTypeIds": "",
    }


def fetch_properties() -> tuple[list[dict], dict[str, int]]:
    """
    POST to the Colive API and return deduplicated properties.
    Returns (properties, source_counts) where source_counts tracks how many
    came from each array before dedup.
    """
    body = _build_request_body()
    logger.info("POST %s  (Date=%s)", API_URL, body["Date"])

    resp = requests.post(API_URL, json=body, headers=_HEADERS, timeout=30)
    if not resp.ok:
        logger.error("HTTP %d from Colive API", resp.status_code)
        return [], {}

    data = resp.json()
    if data.get("Status") != "success":
        logger.error("API returned non-success: %s", data.get("Status"))
        return [], {}

    payload = data.get("Data") or {}
    arrays = [
        ("Property", payload.get("Property") or []),
        ("SimilarProperties", payload.get("SimilarProperties") or []),
        ("TrendingProperties", payload.get("TrendingProperties") or []),
    ]

    seen_ids: set[str] = set()
    deduped: list[dict] = []
    source_counts: dict[str, int] = {}

    for array_name, items in arrays:
        count = 0
        for item in items:
            pid = str(item.get("PropertyID", ""))
            if not pid or pid in seen_ids:
                continue
            seen_ids.add(pid)
            deduped.append(item)
            count += 1
        source_counts[array_name] = count
        logger.info("  %s: %d raw, %d unique (after dedup)", array_name, len(items), count)

    return deduped, source_counts


# ── Normalize ────────────────────────────────────────────────────────────────

def _extract_type_attributes(prop: dict) -> dict:
    attrs: dict = {}

    room_type = (prop.get("RoomType") or "").strip().lower()
    if room_type in _OCCUPANCY_MAP:
        attrs["occupancy"] = _OCCUPANCY_MAP[room_type]

    room_class = (prop.get("RoomClass") or "").strip()
    if room_class:
        attrs["attached_bathroom"] = room_class.lower() == "attached"

    furnish = (prop.get("FurnishStatus") or "").strip()
    if furnish:
        attrs["is_furnished"] = furnish.lower() == "furnished"

    prop_type = prop.get("PropertyType")
    if prop_type:
        attrs["property_type"] = prop_type.strip()

    room_subtype = prop.get("RoomSubType")
    if room_subtype:
        attrs["room_subtype"] = room_subtype.strip()

    rent_with_utility = prop.get("RentWithUtility")
    if rent_with_utility is not None:
        try:
            attrs["rent_with_utility"] = int(rent_with_utility)
        except (ValueError, TypeError):
            pass

    security_deposit = prop.get("SecurityDeposit")
    if security_deposit is not None:
        try:
            sd = int(security_deposit)
            attrs["security_deposit_amount"] = sd
            price = prop.get("Price")
            if price and int(price) > 0:
                attrs["deposit_months"] = round(sd / int(price), 1)
        except (ValueError, TypeError):
            pass

    avail_beds = prop.get("AvailableBedcount")
    if avail_beds is not None:
        try:
            attrs["available_beds"] = int(avail_beds)
        except (ValueError, TypeError):
            pass

    rating = prop.get("PropertyRating")
    if rating is not None:
        try:
            r = float(rating)
            if r > 0:
                attrs["rating"] = r
        except (ValueError, TypeError):
            pass

    if prop.get("IsFlagShip") is True:
        attrs["is_flagship"] = True

    if prop.get("IsColiveNeo") is True:
        attrs["is_neo"] = True

    link = prop.get("Link")
    if link:
        attrs["colive_link"] = link.strip()

    return attrs


def normalize(prop: dict) -> StandardListing | None:
    pid = prop.get("PropertyID")
    if not pid:
        return None

    name = (prop.get("PropertyName") or "").strip()
    locality_raw = (prop.get("LocationName") or "").strip()
    canonical_locality = extract_locality(locality_raw) or locality_raw or None

    price = prop.get("Price")
    rent = None
    if price is not None:
        try:
            rent = int(price)
        except (ValueError, TypeError):
            pass

    lat = None
    lng = None
    try:
        lat = float(prop.get("Latitude") or 0) or None
    except (ValueError, TypeError):
        pass
    try:
        lng = float(prop.get("Longitude") or 0) or None
    except (ValueError, TypeError):
        pass

    images_raw = prop.get("Images") or []
    image_urls = []
    for img in images_raw:
        if isinstance(img, dict):
            url = img.get("DetailedImage")
            if url:
                image_urls.append(url)

    type_attributes = _extract_type_attributes(prop)

    title = name or f"Colive PG in {canonical_locality or 'Bangalore'}"

    return StandardListing(
        source=SOURCE,
        source_id=str(pid),
        source_url=None,
        title=title,
        body=None,
        bhk=None,
        property_type="pg",
        rent=rent,
        locality=canonical_locality,
        latitude=lat,
        longitude=lng,
        listing_type="pg",
        type_attributes=type_attributes,
        image_urls=image_urls,
        posted_at=datetime.now(timezone.utc),
        raw_payload=prop,
    )


# ── Dry-run report ───────────────────────────────────────────────────────────

def _print_dry_run_report(
    listings: list[StandardListing],
    source_counts: dict[str, int],
    skipped_no_rent: int,
):
    total = len(listings)
    print()
    print("=" * 80)
    print("DRY RUN REPORT — Colive PG scraper")
    print("=" * 80)

    print(f"\n1. Total unique properties parsed (with rent): {total}"
          f"  (skipped {skipped_no_rent} with rent=null)")

    print(f"\n2. Breakdown by source array:")
    for name, cnt in source_counts.items():
        print(f"   {name:<25} {cnt:>4} unique")

    print(f"\n3. Sample of 10 listings:")
    for i, l in enumerate(listings[:10], 1):
        print(f"\n  [{i}] source_id={l.source_id}  rent=₹{l.rent}  locality={l.locality}")
        print(f"      title: {(l.title or '')[:100]}")
        print(f"      listing_type: {l.listing_type}")
        print(f"      lat/lng: {l.latitude},{l.longitude}")
        print(f"      images: {len(l.image_urls)} URLs")
        print(f"      type_attributes: {l.type_attributes}")

    std_keys = [
        "occupancy", "attached_bathroom", "is_furnished", "deposit_months",
        "security_deposit_amount", "rent_with_utility", "available_beds",
        "rating", "property_type", "room_subtype",
    ]
    key_counts = {k: 0 for k in std_keys}
    for l in listings:
        for k in std_keys:
            if k in l.type_attributes:
                key_counts[k] += 1

    print(f"\n4. type_attributes coverage:")
    print(f"   {'key':<28} {'count':>5} / {total} = {'pct':>6}")
    print(f"   {'─'*28} {'─'*5}   {'─'*3}   {'─'*6}")
    for k in std_keys:
        pct = (key_counts[k] / total * 100) if total else 0
        print(f"   {k:<28} {key_counts[k]:>5} / {total} = {pct:>5.1f}%")

    loc_dist: dict[str, int] = {}
    for l in listings:
        loc = l.locality or "(unknown)"
        loc_dist[loc] = loc_dist.get(loc, 0) + 1

    print(f"\n5. Locality distribution ({len(loc_dist)} unique):")
    for loc, cnt in sorted(loc_dist.items(), key=lambda x: -x[1]):
        print(f"   {loc:<35} {cnt:>3}")

    print(f"\n6. Zero database writes performed during dry-run. "
          f"Verified by: upsert_listings() call site was guarded by "
          f"'if not dry_run' conditional and never reached.")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Colive PG ingestion script")
    parser.add_argument("--dry-run", action="store_true",
                        help="Fetch and parse but do NOT write to database")
    args = parser.parse_args()
    dry_run = args.dry_run

    if dry_run:
        logger.info("DRY RUN MODE — zero database writes will be performed")

    started_at = datetime.now(timezone.utc)
    run_id = os.environ.get("GITHUB_RUN_ID")
    db_run_id = None
    if not dry_run:
        db_run_id = record_run_start(SOURCE, run_id)

    raw_properties, source_counts = fetch_properties()
    logger.info("Fetched %d unique properties", len(raw_properties))

    all_listings: list[StandardListing] = []
    skipped_no_rent = 0
    for prop in raw_properties:
        try:
            listing = normalize(prop)
        except Exception as e:
            logger.warning("normalize() error: %s", e)
            continue
        if listing is None:
            continue
        if listing.rent is None:
            logger.debug("SKIP rent=null: id=%s title=%.60s", listing.source_id, listing.title)
            skipped_no_rent += 1
            continue
        all_listings.append(listing)

    logger.info(
        "Normalized %d listings (%d skipped: rent=null)",
        len(all_listings), skipped_no_rent,
    )

    if dry_run:
        _print_dry_run_report(all_listings, source_counts, skipped_no_rent)
        return

    stats = UpsertStats()
    if all_listings:
        stats = upsert_listings(all_listings)

    if db_run_id is not None:
        record_run_end(
            db_run_id,
            status="success",
            stats=stats,
            total_fetched=len(all_listings),
            locality_counts={},
            error_message=None,
            started_at=started_at,
        )

    logger.info(
        "Colive ingestion complete: %d fetched, %d new, %d updated, %d errors",
        len(all_listings), stats.total_new, stats.total_updated, stats.total_errors,
    )

    if stats.total_new + stats.total_updated > 0:
        from transforms.fast_path import run_post_ingest_transforms
        run_post_ingest_transforms(SOURCE, started_at)


if __name__ == "__main__":
    main()
