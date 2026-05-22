#!/usr/bin/env python3
"""
Stanza Living PG ingestion script.

Strategy:
  1. Fetch the Bengaluru city page → extract cityMapData (all 86 residences,
     basic fields) from __NEXT_DATA__.
  2. Collect all unique micromarket slugs from cityMapData.
  3. Fetch each micromarket page → extract the rich residences list (facilities,
     features, occupancy options, images, ratings, address).
  4. Merge: enrich cityMapData entries with the richer micromarket data where
     available; fall back to basic fields otherwise.

This covers ~84/86 residences with rich data in ~27 HTTP requests.

Usage:
    python -m ingestion.ingest_stanza               # production run
    python -m ingestion.ingest_stanza --dry-run      # fetch + parse, zero DB writes

Environment:
    SUPABASE_DB_URL  — Supabase Postgres connection string (required)
    GITHUB_RUN_ID    — set automatically by GitHub Actions (optional)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
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
from localities import extract_locality, haversine_km, LOCALITY_META

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ingest_stanza")

# ── Constants ────────────────────────────────────────────────────────────────

SOURCE = "stanza"
CITY_SLUG = "bengaluru"
CITY_BASE_URL = f"https://www.stanzaliving.com/{CITY_SLUG}/"
SLEEP_BETWEEN_REQUESTS = 1.0

_HEADERS = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "referer": "https://www.stanzaliving.com/",
    "user-agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/127.0.0.0 Safari/537.36"
    ),
}

_GENDER_MAP = {
    "MALE": "male",
    "FEMALE": "female",
    "CO_ED": "co-ed",
}

# URL segment used in stanza.com property URLs: /{city}/{micromarket}/{gender_url}/{slug}
_GENDER_URL_SEGMENT = {
    "MALE": "male",
    "FEMALE": "female",
    "CO_ED": "co_ed",
}

_ATTACHED_WASHROOM_FEATURE_ID = 12
_AC_FEATURE_ID = 15
_BALCONY_FEATURE_ID = 4
_MEALS_FACILITY_ID = 25


# ── Locality helpers ─────────────────────────────────────────────────────────

def _find_nearest_locality(lat: float | None, lng: float | None, max_km: float = 4.0) -> str | None:
    """
    Given coordinates, return the canonical locality name whose centre is
    within max_km km.  Returns None when no locality is close enough.
    """
    if lat is None or lng is None:
        return None
    best_name, best_dist = None, max_km
    for name, meta in LOCALITY_META.items():
        coords = meta.get("coords")
        if not coords:
            continue
        d = haversine_km(lat, lng, coords[0], coords[1])
        if d < best_dist:
            best_name, best_dist = name, d
    return best_name


def _resolve_locality(locality_raw: str, lat: float | None, lng: float | None) -> str | None:
    """
    1. Try substring/alias match via extract_locality().
    2. Fall back to nearest canonical locality by lat/lng.
    3. Fall back to the raw micromarket name.
    """
    canonical = extract_locality(locality_raw)
    if canonical:
        return canonical
    geo = _find_nearest_locality(lat, lng)
    if geo:
        return geo
    return locality_raw or None


# ── HTML / __NEXT_DATA__ helpers ──────────────────────────────────────────────

def _fetch_page_props(session: requests.Session, url: str) -> dict | None:
    """Fetch a URL and extract the Next.js pageProps from __NEXT_DATA__."""
    try:
        resp = session.get(url, headers=_HEADERS, timeout=30)
    except Exception as e:
        logger.error("Request failed for %s: %s", url, e)
        return None

    if not resp.ok:
        logger.error("HTTP %d for %s", resp.status_code, url)
        return None

    match = re.search(
        r'<script\s+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
        resp.text, re.DOTALL
    )
    if not match:
        logger.error("No __NEXT_DATA__ found at %s", url)
        return None

    try:
        nd = json.loads(match.group(1))
    except json.JSONDecodeError as e:
        logger.error("Failed to parse __NEXT_DATA__ at %s: %s", url, e)
        return None

    return (
        nd.get("props", {}).get("pageProps")
        or nd.get("pageProps")
        or {}
    )


# ── Fetch strategy ────────────────────────────────────────────────────────────

def fetch_all_data(session: requests.Session) -> tuple[list[dict], dict[str, dict], int]:
    """
    Phase 1: Fetch the city page to get cityMapData (all 86 residences, basic).
    Phase 2: Fetch each micromarket page to get rich residence data.

    Returns:
        city_map_items  — list of basic dicts from cityMapData (all residences)
        rich_by_id      — dict keyed by str(residenceId) → rich residence dict
        http_requests   — total HTTP requests made
    """
    http_requests = 0

    # ── Phase 1: city page ────────────────────────────────────────────────────
    logger.info("Phase 1: fetching city page %s", CITY_BASE_URL)
    page_props = _fetch_page_props(session, CITY_BASE_URL)
    http_requests += 1

    if not page_props:
        return [], {}, http_requests

    city_map_items: list[dict] = page_props.get("cityMapData") or []
    logger.info("cityMapData: %d residences found", len(city_map_items))

    if not city_map_items:
        logger.error("cityMapData is empty — aborting")
        return [], {}, http_requests

    # Collect unique micromarket slugs (preserving order of first appearance)
    seen_slugs: set[str] = set()
    mm_slugs: list[str] = []
    for item in city_map_items:
        slug = item.get("micromarketSlug")
        if slug and slug not in seen_slugs:
            seen_slugs.add(slug)
            mm_slugs.append(slug)

    logger.info("Phase 1 complete: %d unique micromarkets to fetch", len(mm_slugs))

    # ── Phase 2: micromarket pages ────────────────────────────────────────────
    rich_by_id: dict[str, dict] = {}

    for i, mm_slug in enumerate(mm_slugs, 1):
        mm_url = f"{CITY_BASE_URL}{mm_slug}/"
        logger.info("Phase 2 [%d/%d]: fetching %s", i, len(mm_slugs), mm_url)
        time.sleep(SLEEP_BETWEEN_REQUESTS)

        props = _fetch_page_props(session, mm_url)
        http_requests += 1

        if not props:
            continue

        residences = props.get("residences") or []
        new_count = 0
        for res in residences:
            rid = str(res.get("residenceId", ""))
            if rid and rid not in rich_by_id:
                rich_by_id[rid] = res
                new_count += 1

        logger.info(
            "  %s: %d residences, %d new rich entries (total enriched: %d)",
            mm_slug, len(residences), new_count, len(rich_by_id)
        )

    logger.info(
        "Phase 2 complete: %d/%d residences enriched with rich data",
        len(rich_by_id), len(city_map_items),
    )
    return city_map_items, rich_by_id, http_requests


# ── Normalize ─────────────────────────────────────────────────────────────────

def _extract_type_attributes_rich(res: dict) -> dict:
    """Build type_attributes from a rich residence dict (micromarket page data)."""
    attrs: dict = {}

    gender = (res.get("gender") or "").upper()
    if gender in _GENDER_MAP:
        attrs["gender_pref"] = _GENDER_MAP[gender]

    for src_key, dst_key in (("rating", "rating"), ("pulseRating", "pulse_rating")):
        val = res.get(src_key)
        if val is not None:
            try:
                f = float(val)
                if f > 0:
                    attrs[dst_key] = f
            except (ValueError, TypeError):
                pass

    discount_pct = res.get("discountPercentage")
    if discount_pct:
        try:
            dp = float(discount_pct)
            if dp > 0:
                attrs["discount_pct"] = dp
        except (ValueError, TypeError):
            pass

    discounted_price = res.get("discountedPrice")
    if discounted_price is not None:
        try:
            attrs["discounted_price"] = int(discounted_price)
        except (ValueError, TypeError):
            pass

    fomo = res.get("fomoTagName")
    if fomo:
        attrs["fomo_tag"] = fomo

    mm = res.get("micromarketName")
    if mm:
        attrs["micromarket"] = mm

    # Occupancy options
    occupancies = res.get("residenceOccupancies") or []
    occ_list = []
    for occ in occupancies:
        occ_price = occ.get("startingPrice")
        if not occ_price:
            continue
        entry: dict = {
            "type": (occ.get("occupancyName") or "").lower(),
            "people": occ.get("occupancyOccupancy"),
            "price": int(occ_price),
        }
        if occ.get("soldOut"):
            entry["sold_out"] = True
        disc = occ.get("discountedPrice")
        if disc:
            entry["discounted_price"] = int(disc)
        occ_list.append(entry)
    if occ_list:
        attrs["occupancy_options"] = occ_list

    # Facilities
    facilities = res.get("facilities") or []
    enabled_facilities = [f for f in facilities if f.get("enabled", True)]
    facility_ids = {f.get("facilityId") for f in enabled_facilities}
    facility_names = [f.get("name", "") for f in enabled_facilities if f.get("name")]
    if _MEALS_FACILITY_ID in facility_ids:
        attrs["meals_included"] = True
    if facility_names:
        attrs["facilities"] = facility_names

    # Features
    features = res.get("features") or []
    enabled_features = [f for f in features if f.get("enabled", True)]
    feature_ids = {f.get("featureId") for f in enabled_features}
    feature_names = [f.get("name", "") for f in enabled_features if f.get("name")]
    if _ATTACHED_WASHROOM_FEATURE_ID in feature_ids:
        attrs["attached_bathroom"] = True
    if _AC_FEATURE_ID in feature_ids:
        attrs["has_ac"] = True
    if _BALCONY_FEATURE_ID in feature_ids:
        attrs["has_balcony"] = True
    if feature_names:
        attrs["features"] = feature_names

    entity_type = res.get("propertyEntityType")
    if entity_type:
        attrs["property_entity_type"] = entity_type

    dist = res.get("distanceFromPlace")
    if dist is not None:
        try:
            attrs["distance_km"] = float(dist)
        except (ValueError, TypeError):
            pass

    return attrs


def _extract_type_attributes_basic(item: dict) -> dict:
    """Build type_attributes from a cityMapData entry (basic fields only)."""
    attrs: dict = {}

    gender = (item.get("gender") or "").upper()
    if gender in _GENDER_MAP:
        attrs["gender_pref"] = _GENDER_MAP[gender]

    fomo = item.get("fomoTag")
    if fomo:
        attrs["fomo_tag"] = fomo

    mm = item.get("micromarketName")
    if mm:
        attrs["micromarket"] = mm

    entity_type = item.get("propertyEntityType")
    if entity_type:
        attrs["property_entity_type"] = entity_type

    discounted = item.get("discountedPrice")
    if discounted is not None:
        try:
            attrs["discounted_price"] = int(discounted)
        except (ValueError, TypeError):
            pass

    return attrs


def normalize_rich(res: dict) -> StandardListing | None:
    """Normalize a full rich residence dict (from micromarket page)."""
    residence_id = res.get("residenceId")
    if not residence_id:
        return None

    name = (res.get("name") or "").strip()
    slug = (res.get("slug") or "").strip()

    lat = lng = None
    try:
        lat = float(res.get("latitude") or 0) or None
    except (ValueError, TypeError):
        pass
    try:
        lng = float(res.get("longitude") or 0) or None
    except (ValueError, TypeError):
        pass

    locality_raw = res.get("micromarketName") or ""
    canonical_locality = _resolve_locality(locality_raw, lat, lng)

    addr_dto = res.get("addressResponseDTO") or {}
    address = addr_dto.get("displayAddress") or None
    contact_phone = addr_dto.get("phone") or None

    maps_url = res.get("googleMapLink") or None

    rent = None
    price = res.get("startingPrice")
    if price is not None:
        try:
            rent = int(price)
        except (ValueError, TypeError):
            pass

    images_raw = res.get("images") or []
    images_sorted = sorted(
        images_raw,
        key=lambda x: (not x.get("featuredImage", False), x.get("imageOrder", 999))
    )
    image_urls = [img["imageUrl"] for img in images_sorted if img.get("imageUrl")]
    thumbnail_url = image_urls[0] if image_urls else None

    type_attributes = _extract_type_attributes_rich(res)
    amenities = (type_attributes.get("facilities") or []) + (type_attributes.get("features") or [])

    city_slug = (res.get("citySlug") or CITY_SLUG).strip()
    mm_slug = (res.get("micromarketSlug") or "").strip()
    gender_raw = (res.get("gender") or "").upper()
    gender_url = _GENDER_URL_SEGMENT.get(gender_raw, "co_ed")
    if slug and mm_slug:
        source_url = f"https://www.stanzaliving.com/{city_slug}/{mm_slug}/{gender_url}/{slug}"
    elif slug:
        source_url = f"https://www.stanzaliving.com/{city_slug}/{gender_url}/{slug}"
    else:
        source_url = None
    title = name or f"Stanza Living PG in {canonical_locality or 'Bangalore'}"

    return StandardListing(
        source=SOURCE,
        source_id=str(residence_id),
        source_url=source_url,
        title=title,
        body=(res.get("seoDescription") or None),
        bhk=None,
        property_type="pg",
        furnishing="Fully Furnished",
        rent=rent,
        locality=canonical_locality,
        address=address,
        latitude=lat,
        longitude=lng,
        maps_url=maps_url,
        amenities=amenities,
        contact_phone=contact_phone,
        listing_type="pg",
        type_attributes=type_attributes,
        thumbnail_url=thumbnail_url,
        image_urls=image_urls,
        society_name=name or None,
        posted_at=datetime.now(timezone.utc),
        raw_payload=res,
    )


def normalize_basic(item: dict) -> StandardListing | None:
    """Normalize a cityMapData entry (basic fields only, no facilities/features)."""
    residence_id = item.get("residenceId")
    if not residence_id:
        return None

    name = (item.get("name") or "").strip()
    slug = (item.get("slug") or "").strip()

    lat = lng = None
    try:
        lat = float(item.get("latitude") or 0) or None
    except (ValueError, TypeError):
        pass
    try:
        lng = float(item.get("longitude") or 0) or None
    except (ValueError, TypeError):
        pass

    locality_raw = item.get("micromarketName") or ""
    canonical_locality = _resolve_locality(locality_raw, lat, lng)

    rent = None
    price = item.get("startingPrice")
    if price is not None:
        try:
            rent = int(price)
        except (ValueError, TypeError):
            pass

    image_urls = []
    img_url = item.get("imageUrl")
    if img_url:
        image_urls = [img_url]
    thumbnail_url = image_urls[0] if image_urls else None

    type_attributes = _extract_type_attributes_basic(item)
    city_slug = (item.get("citySlug") or CITY_SLUG).strip()
    mm_slug = (item.get("micromarketSlug") or "").strip()
    gender_raw = (item.get("gender") or "").upper()
    gender_url = _GENDER_URL_SEGMENT.get(gender_raw, "co_ed")
    if slug and mm_slug:
        source_url = f"https://www.stanzaliving.com/{city_slug}/{mm_slug}/{gender_url}/{slug}"
    elif slug:
        source_url = f"https://www.stanzaliving.com/{city_slug}/{gender_url}/{slug}"
    else:
        source_url = None
    title = name or f"Stanza Living PG in {canonical_locality or 'Bangalore'}"

    return StandardListing(
        source=SOURCE,
        source_id=str(residence_id),
        source_url=source_url,
        title=title,
        body=None,
        bhk=None,
        property_type="pg",
        furnishing="Fully Furnished",
        rent=rent,
        locality=canonical_locality,
        address=None,
        latitude=lat,
        longitude=lng,
        listing_type="pg",
        type_attributes=type_attributes,
        thumbnail_url=thumbnail_url,
        image_urls=image_urls,
        society_name=name or None,
        posted_at=datetime.now(timezone.utc),
        raw_payload=item,
    )


# ── Dry-run report ────────────────────────────────────────────────────────────

def _print_dry_run_report(
    listings: list[StandardListing],
    http_requests: int,
    skipped_no_rent: int,
    rich_count: int,
    basic_count: int,
):
    total = len(listings)
    print()
    print("=" * 80)
    print("DRY RUN REPORT — Stanza Living PG scraper")
    print("=" * 80)
    print(f"\n1. Total residences parsed (with rent): {total}  (skipped {skipped_no_rent} with rent=null)")
    print(f"   Rich (full data):  {rich_count}")
    print(f"   Basic (map only):  {basic_count}")
    print(f"2. Total HTTP requests: {http_requests}")

    print("\n3. Sample of 10 listings:")
    for i, l in enumerate(listings[:10], 1):
        print(f"\n  [{i}] source_id={l.source_id}  rent=₹{l.rent}  locality={l.locality}")
        print(f"      title: {(l.title or '')[:100]}")
        print(f"      url:   {l.source_url}")
        print(f"      lat/lng: {l.latitude},{l.longitude}")
        print(f"      images: {len(l.image_urls)} URLs")
        ta_display = {
            k: v for k, v in l.type_attributes.items()
            if k not in ("occupancy_options", "facilities", "features")
        }
        print(f"      type_attributes: {ta_display}")
        occ = l.type_attributes.get("occupancy_options", [])
        if occ:
            print(f"      occupancies: {[o['type'] + ' ₹' + str(o['price']) for o in occ]}")

    std_keys = ["gender_pref", "meals_included", "attached_bathroom", "has_ac", "rating", "occupancy_options"]
    key_counts = {k: 0 for k in std_keys}
    for l in listings:
        for k in std_keys:
            if k in l.type_attributes:
                key_counts[k] += 1

    print(f"\n4. type_attributes coverage:")
    print(f"   {'key':<22} {'count':>6} / {total} = pct")
    print(f"   {'─'*22} {'─'*6}   {'─'*3}")
    for k in std_keys:
        pct = (key_counts[k] / total * 100) if total else 0
        print(f"   {k:<22} {key_counts[k]:>6} / {total} = {pct:>5.1f}%")

    loc_dist: dict[str, int] = {}
    for l in listings:
        loc = l.locality or "(unknown)"
        loc_dist[loc] = loc_dist.get(loc, 0) + 1

    print(f"\n5. Locality distribution ({len(loc_dist)} unique):")
    for loc, cnt in sorted(loc_dist.items(), key=lambda x: -x[1]):
        print(f"   {loc:<35} {cnt:>4}")

    print(f"\n6. Zero database writes performed. upsert_listings() never called.")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Stanza Living PG ingestion script")
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
    session.headers.update(_HEADERS)

    city_map_items, rich_by_id, http_requests = fetch_all_data(session)
    logger.info(
        "Fetch complete: %d total residences, %d enriched, %d HTTP requests",
        len(city_map_items), len(rich_by_id), http_requests,
    )

    all_listings: list[StandardListing] = []
    skipped_no_rent = 0
    rich_count = 0
    basic_count = 0

    seen_ids: set[str] = set()
    for item in city_map_items:
        rid = str(item.get("residenceId", ""))
        if not rid or rid in seen_ids:
            continue
        seen_ids.add(rid)

        try:
            if rid in rich_by_id:
                listing = normalize_rich(rich_by_id[rid])
                is_rich = True
            else:
                listing = normalize_basic(item)
                is_rich = False
        except Exception as e:
            logger.warning("normalize() error for id=%s: %s", rid, e)
            continue

        if listing is None:
            continue
        if listing.rent is None:
            skipped_no_rent += 1
            continue

        all_listings.append(listing)
        if is_rich:
            rich_count += 1
        else:
            basic_count += 1

    logger.info(
        "Normalized %d listings (%d rich, %d basic, %d skipped: rent=null)",
        len(all_listings), rich_count, basic_count, skipped_no_rent,
    )

    if dry_run:
        _print_dry_run_report(all_listings, http_requests, skipped_no_rent, rich_count, basic_count)
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
        "Stanza ingestion complete: %d fetched, %d new, %d updated, %d errors",
        len(all_listings), stats.total_new, stats.total_updated, stats.total_errors,
    )

    if stats.total_new + stats.total_updated > 0:
        from transforms.fast_path import run_post_ingest_transforms
        run_post_ingest_transforms(SOURCE, started_at)

    from sync.trigger import trigger_sync_after_completion
    trigger_sync_after_completion(reason="ingest_stanza")


if __name__ == "__main__":
    main()
