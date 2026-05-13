#!/usr/bin/env python3
"""
Zolo PG ingestion script.

Fetches PG/co-living listings from Zolo's public search API and upserts them
into the listings table via the shared db.py layer.

Usage:
    python -m ingestion.ingest_zolo               # production run
    python -m ingestion.ingest_zolo --dry-run      # fetch + parse, zero DB writes

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
import time
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
logger = logging.getLogger("ingest_zolo")

# ── Constants ────────────────────────────────────────────────────────────────

SOURCE = "zolo"
API_URL = "https://api.zolostays.com/api/v7/centers/search"
CITY_KEY = "bangalore"
PAGE_LIMIT = 100
SLEEP_BETWEEN_PAGES = 0.5

_GENDER_MAP = {
    "couple": "co-ed",
    "women": "female",
    "men": "male",
    "any": "co-ed",
}


# ── Pagination + fetch ───────────────────────────────────────────────────────

def fetch_all_centers(session: requests.Session) -> tuple[list[dict], int]:
    """
    Paginate through the Zolo search API and return all center objects.
    Returns (centers_list, total_http_requests).
    """
    all_centers: list[dict] = []
    offset = 0
    http_requests = 0

    while True:
        params = {
            "cityKey": CITY_KEY,
            "offset": offset,
            "limit": PAGE_LIMIT,
            "maxPrice": 999999,
            "sortBy": "",
        }
        try:
            resp = session.get(API_URL, params=params, timeout=30)
            http_requests += 1
        except Exception as e:
            logger.error("Request failed at offset=%d: %s", offset, e)
            break

        if not resp.ok:
            logger.error("HTTP %d at offset=%d", resp.status_code, offset)
            break

        try:
            data = resp.json()
        except Exception:
            logger.error("Invalid JSON at offset=%d", offset)
            break

        if data.get("error") != 0:
            logger.error("API error at offset=%d: %s", offset, data)
            break

        results = data.get("result") or []
        if not results:
            logger.info("Empty result array at offset=%d — stopping", offset)
            break

        bucket = results[0]
        centers = bucket.get("centers") or []
        is_last = bucket.get("isLast", True)
        next_offset = bucket.get("nextOffset", offset + len(centers))

        batch_size = len(centers)
        all_centers.extend(centers)
        logger.info(
            "  offset=%d: %d centers (isLast=%s, nextOffset=%s)",
            offset, batch_size, is_last, next_offset,
        )

        if is_last or batch_size == 0:
            break

        offset = next_offset
        time.sleep(SLEEP_BETWEEN_PAGES)

    return all_centers, http_requests


# ── Normalize ────────────────────────────────────────────────────────────────

def _extract_type_attributes(basic: dict) -> dict:
    """Build type_attributes from basicData fields."""
    attrs: dict = {}

    gender = (basic.get("gender") or "").lower()
    if gender in _GENDER_MAP:
        attrs["gender_pref"] = _GENDER_MAP[gender]

    max_rent = basic.get("maxRent")
    if max_rent is not None:
        attrs["rent_max"] = int(max_rent)

    pretax = basic.get("preTaxMinRent")
    if pretax is not None:
        attrs["pretax_min_rent"] = int(pretax)

    prop_cat = basic.get("propertyCategory")
    if prop_cat:
        attrs["property_category"] = prop_cat

    if basic.get("isShortStayProperty") is True:
        attrs["is_short_stay"] = True

    zolo_code = basic.get("zoloCode")
    if zolo_code:
        attrs["zolo_code"] = zolo_code

    # Amenities
    amenities_raw = basic.get("amenities") or []
    amenities_flat: dict[str, bool] = {}
    has_meals = None
    has_bathroom = None

    for a in amenities_raw:
        if not isinstance(a, dict):
            continue
        name = a.get("name")
        available = a.get("isAvailable")
        if name and available is not None:
            amenities_flat[name] = available
            if name in ("lunch", "delicious_nutritious_menu"):
                if available:
                    has_meals = True
                elif has_meals is None:
                    has_meals = False
            if name == "bathroom":
                has_bathroom = available

    if has_meals is not None:
        attrs["meals_included"] = has_meals
    if has_bathroom is not None:
        attrs["attached_bathroom"] = has_bathroom

    if amenities_flat:
        attrs["amenities"] = amenities_flat

    # Discount
    discount_obj = basic.get("rentalDiscount") or {}
    discount_pct = discount_obj.get("max_rental_discount")
    if discount_pct and discount_pct > 0:
        attrs["discount_pct"] = discount_pct

    return attrs


def normalize(center: dict) -> StandardListing | None:
    """Convert one Zolo center object into a StandardListing."""
    basic = center.get("basicData") or {}

    center_id = basic.get("id")
    if not center_id:
        return None

    name = basic.get("name") or ""
    description = basic.get("description") or ""

    min_rent = basic.get("minRent")
    rent = int(min_rent) if min_rent is not None else None

    # Location: [longitude, latitude]
    location = basic.get("location") or []
    lat = float(location[1]) if len(location) > 1 else None
    lng = float(location[0]) if len(location) > 0 else None

    addr_parts = []
    for key in ("addressLine1", "addressLine2"):
        v = basic.get(key)
        if v and str(v).strip():
            addr_parts.append(str(v).strip())
    address = ", ".join(addr_parts) or None

    raw_locality = basic.get("locality") or ""
    canonical_locality = extract_locality(raw_locality) or raw_locality or None

    # Images live at center top level, not inside basicData
    images_raw = center.get("images") or []
    image_urls = []
    for img in images_raw:
        if isinstance(img, dict):
            url = img.get("url")
            if url:
                image_urls.append(url)
        elif isinstance(img, str):
            image_urls.append(img)

    type_attributes = _extract_type_attributes(basic)

    title = name.strip() or f"PG in {canonical_locality or 'Bangalore'}"

    return StandardListing(
        source=SOURCE,
        source_id=str(center_id),
        source_url=None,
        title=title,
        body=(description[:5000] if description else None),
        bhk=None,
        property_type="pg",
        rent=rent,
        locality=canonical_locality,
        address=address,
        latitude=lat,
        longitude=lng,
        listing_type="pg",
        type_attributes=type_attributes,
        image_urls=image_urls,
        posted_at=datetime.now(timezone.utc),
        raw_payload=center,
    )


# ── Dry-run report ───────────────────────────────────────────────────────────

def _print_dry_run_report(
    listings: list[StandardListing],
    http_requests: int,
    actual_batch_size: int | None,
    skipped_no_rent: int,
):
    total = len(listings)
    print()
    print("=" * 80)
    print(f"DRY RUN REPORT — Zolo PG scraper")
    print("=" * 80)

    print(f"\n1. First-batch size: {actual_batch_size}")
    print(f"2. Total listings parsed (with rent): {total}  (skipped {skipped_no_rent} with rent=null)")
    print(f"3. Total HTTP requests: {http_requests}")

    # Sample of 10
    print("\n4. Sample of 10 listings:")
    for i, l in enumerate(listings[:10], 1):
        print(f"\n  [{i}] source_id={l.source_id}  rent=₹{l.rent}  locality={l.locality}")
        print(f"      title: {(l.title or '')[:100]}")
        print(f"      body:  {(l.body or '')[:120]}")
        print(f"      listing_type: {l.listing_type}")
        print(f"      lat/lng: {l.latitude},{l.longitude}")
        print(f"      images: {len(l.image_urls)} URLs")
        ta = {k: v for k, v in l.type_attributes.items() if k != "amenities"}
        print(f"      type_attributes (excl amenities): {ta}")
        amen = l.type_attributes.get("amenities", {})
        avail = [k for k, v in amen.items() if v]
        print(f"      amenities available: {avail[:15]}{'...' if len(avail) > 15 else ''}")

    # Coverage table
    std_keys = ["gender_pref", "meals_included", "attached_bathroom"]
    key_counts = {k: 0 for k in std_keys}
    for l in listings:
        for k in std_keys:
            if k in l.type_attributes:
                key_counts[k] += 1

    print(f"\n5. type_attributes coverage (standardized keys):")
    print(f"   {'key':<22} {'count':>6} / {total} = {'pct':>6}")
    print(f"   {'─'*22} {'─'*6}   {'─'*5}   {'─'*6}")
    for k in std_keys:
        pct = (key_counts[k] / total * 100) if total else 0
        print(f"   {k:<22} {key_counts[k]:>6} / {total} = {pct:>5.1f}%")

    # Locality distribution
    loc_dist: dict[str, int] = {}
    for l in listings:
        loc = l.locality or "(unknown)"
        loc_dist[loc] = loc_dist.get(loc, 0) + 1

    print(f"\n6. Locality distribution ({len(loc_dist)} unique):")
    for loc, cnt in sorted(loc_dist.items(), key=lambda x: -x[1])[:30]:
        print(f"   {loc:<35} {cnt:>4}")
    if len(loc_dist) > 30:
        print(f"   ... and {len(loc_dist) - 30} more")

    print(f"\n7. Zero database writes performed during dry-run. "
          f"Verified by: upsert_listings() call site was guarded by "
          f"'if not dry_run' conditional and never reached.")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Zolo PG ingestion script")
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

    session = requests.Session()
    session.headers.update({
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; NestIQ/1.0)",
    })

    logger.info("Fetching Zolo PG listings for city=%s", CITY_KEY)
    raw_centers, http_requests = fetch_all_centers(session)
    logger.info("Fetched %d centers in %d requests", len(raw_centers), http_requests)

    actual_batch_size = None
    if raw_centers:
        actual_batch_size = min(len(raw_centers), PAGE_LIMIT)

    # Normalize
    all_listings: list[StandardListing] = []
    skipped_no_rent = 0
    for center in raw_centers:
        try:
            listing = normalize(center)
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

    # Dry-run report
    if dry_run:
        _print_dry_run_report(all_listings, http_requests, actual_batch_size, skipped_no_rent)
        return

    # Production upsert
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
        "Zolo ingestion complete: %d fetched, %d new, %d updated, %d errors",
        len(all_listings), stats.total_new, stats.total_updated, stats.total_errors,
    )

    if stats.total_new + stats.total_updated > 0:
        from transforms.fast_path import run_post_ingest_transforms
        run_post_ingest_transforms(SOURCE, started_at)


if __name__ == "__main__":
    main()
