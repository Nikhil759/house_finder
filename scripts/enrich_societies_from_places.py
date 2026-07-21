#!/usr/bin/env python3
"""
enrich_societies_from_places.py — Fill in coordinates and exterior photos
for `societies` rows using the Google Places API.

This is the generalized, top-down successor to enrich_society_images.py:
that script only ever looked at societies already implied by >=2 scraped
listings and cached photos in a side table (society_images) keyed by fuzzy
name match. This script instead operates directly on the `societies`
table (any city), writing latitude/longitude/place_id/image_urls onto the
row itself, so a society can have real coordinates and photos before a
single listing has been linked to it.

Steps per society (rows with place_id IS NULL, or --force for all):
  1. Google Places Text Search: "{name} {locality} {city}"
  2. Confidence check: valid place type + name token overlap
  3. Download up to 3 photos, upload to Supabase Storage
     -> societies/{place_id}/1.jpg, 2.jpg, 3.jpg
  4. Update the societies row: latitude, longitude, place_id, image_urls

Usage:
    python3 scripts/enrich_societies_from_places.py
    python3 scripts/enrich_societies_from_places.py --city gurgaon
    python3 scripts/enrich_societies_from_places.py --dry-run
    python3 scripts/enrich_societies_from_places.py --force --limit 10
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    print("ERROR: python-dotenv not installed.  Run: pip install python-dotenv")
    sys.exit(1)

env_path = Path(__file__).resolve().parent.parent / "backend" / ".env"
# override=True: a stale key exported into this shell session by an earlier
# `source .env` call should not shadow a value you just edited in the file.
load_dotenv(env_path if env_path.exists() else None, override=True)

try:
    import requests
except ImportError:
    print("ERROR: requests not installed.  Run: pip install requests")
    sys.exit(1)

try:
    from supabase import create_client, Client
except ImportError:
    print("ERROR: supabase not installed.  Run: pip install supabase")
    sys.exit(1)

# ── CLI ────────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(
    description="Geocode + fetch exterior photos for societies via Google Places"
)
parser.add_argument("--dry-run", action="store_true", help="Search only, skip download/upload/write")
parser.add_argument("--force", action="store_true", help="Re-fetch even societies that already have a place_id")
parser.add_argument("--city", default=None, metavar="CITY", help="Only process societies for this city (default: all)")
parser.add_argument("--limit", type=int, default=None, metavar="N", help="Process at most N societies")
args = parser.parse_args()

DRY_RUN: bool = args.dry_run
FORCE: bool = args.force
CITY_FILTER: str | None = args.city
LIMIT: int | None = args.limit

# ── Config ─────────────────────────────────────────────────────────────────────
SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY: str = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY", "")
GOOGLE_API_KEY: str = os.environ.get("GOOGLE_PLACES_API_KEY", "")
BUCKET = "nestiq-images"
MAX_PHOTOS = 3
BATCH_SIZE = 50
SLEEP_BETWEEN = 0.5
OVER_LIMIT_SLEEP = 5.0

TEXTSEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"
PHOTO_URL = "https://maps.googleapis.com/maps/api/place/photo"

TEXTSEARCH_COST = 0.017
PHOTO_COST = 0.007

VALID_TYPES = {
    "premise",
    "establishment",
    "point_of_interest",
    "real_estate_agency",
    "apartment_complex",
}

missing_names = []
if not SUPABASE_URL:
    missing_names.append("SUPABASE_URL")
if not SUPABASE_KEY:
    missing_names.append("SUPABASE_SERVICE_KEY / SUPABASE_KEY")
if not GOOGLE_API_KEY:
    missing_names.append("GOOGLE_PLACES_API_KEY")
if missing_names:
    print(f"ERROR: Missing environment variables: {', '.join(missing_names)}")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

WIDTH = 60


def section(title: str) -> None:
    print()
    print("─" * WIDTH)
    print(f"  {title}")
    print("─" * WIDTH)


def tokenize(name: str) -> set[str]:
    return {w for w in re.split(r"\W+", name.lower()) if len(w) >= 3}


def match_confidence(society_name: str, google_name: str) -> str:
    s_tokens = tokenize(society_name)
    g_tokens = tokenize(google_name)
    if not s_tokens or not g_tokens:
        return "low"
    overlap = s_tokens & g_tokens
    ratio = len(overlap) / max(len(s_tokens), len(g_tokens))
    return "high" if ratio >= 0.5 else "low"


# ── Step 1: load work list ──────────────────────────────────────────────────
def get_societies() -> list[dict]:
    """Return societies missing a place_id (or all, with --force)."""
    all_rows: list[dict] = []
    offset = 0
    while True:
        q = supabase.table("societies").select("id, city, name, locality, developer, place_id")
        if not FORCE:
            q = q.is_("place_id", "null")
        if CITY_FILTER:
            q = q.eq("city", CITY_FILTER)
        resp = q.range(offset, offset + BATCH_SIZE - 1).execute()
        batch = resp.data or []
        all_rows.extend(batch)
        if len(batch) < BATCH_SIZE:
            break
        offset += BATCH_SIZE
    return all_rows


# ── Step 2: text search ─────────────────────────────────────────────────────────
def text_search_society(
    name: str, locality: str | None, city: str
) -> tuple[str | None, str | None, list[str], list[float] | None]:
    """
    Returns (place_id, google_name, photo_references[:3], [lat, lng]) or
            (None, None, [], None) on failure / low-confidence match.
    """
    query_parts = [name]
    if locality:
        query_parts.append(locality)
    query_parts.append(city.title())
    query = " ".join(query_parts)

    for attempt in range(2):
        try:
            resp = requests.get(
                TEXTSEARCH_URL,
                params={"query": query, "key": GOOGLE_API_KEY},
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            print(f"    Text Search request error: {exc}")
            return None, None, [], None

        status = data.get("status")

        if status == "OVER_QUERY_LIMIT":
            if attempt == 0:
                print(f"    OVER_QUERY_LIMIT — sleeping {OVER_LIMIT_SLEEP}s and retrying…")
                time.sleep(OVER_LIMIT_SLEEP)
                continue
            print("    OVER_QUERY_LIMIT on retry — skipping")
            return None, None, [], None

        if status != "OK":
            if status not in ("ZERO_RESULTS",):
                print(f"    Text Search status: {status!r} for {name!r}")
            return None, None, [], None

        results = data.get("results", [])
        if not results:
            return None, None, [], None

        place = results[0]
        place_id = place.get("place_id", "")
        google_name = place.get("name", "")
        types = place.get("types", [])
        photos = place.get("photos", [])
        geometry = place.get("geometry", {}).get("location", {})

        if not VALID_TYPES.intersection(types):
            print(f"    Skipping {name!r}: no valid type (got {types[:4]})")
            return None, None, [], None

        s_tokens = tokenize(name)
        g_tokens = tokenize(google_name)
        if s_tokens and g_tokens and not (s_tokens & g_tokens):
            print(f"    Skipping {name!r}: zero name overlap (Google matched {google_name!r})")
            return None, None, [], None

        photo_refs = [p["photo_reference"] for p in photos[:MAX_PHOTOS] if p.get("photo_reference")]
        coords = [geometry["lat"], geometry["lng"]] if geometry.get("lat") is not None else None

        return place_id, google_name, photo_refs, coords

    return None, None, [], None


# ── Step 3: fetch image ─────────────────────────────────────────────────────────
def fetch_image(photo_reference: str) -> tuple[bytes | None, str | None]:
    try:
        resp = requests.get(
            PHOTO_URL,
            params={"maxwidth": 1200, "photo_reference": photo_reference, "key": GOOGLE_API_KEY},
            timeout=20,
            allow_redirects=True,
        )
        resp.raise_for_status()
    except Exception as exc:
        print(f"    Photo fetch error: {exc}")
        return None, None

    content_type = resp.headers.get("Content-Type", "")
    if not content_type.startswith("image/"):
        print(f"    Unexpected content-type: {content_type!r} — skipping")
        return None, None

    return resp.content, content_type


# ── Step 4: upload to Supabase Storage ────────────────────────────────────────
def upload_photos(place_id: str, photo_refs: list[str]) -> list[str]:
    public_urls: list[str] = []
    for idx, ref in enumerate(photo_refs, start=1):
        image_bytes, content_type = fetch_image(ref)
        if image_bytes is None:
            continue

        path = f"societies/{place_id}/{idx}.jpg"
        try:
            supabase.storage.from_(BUCKET).upload(
                path,
                image_bytes,
                file_options={"content-type": content_type, "upsert": "true"},
            )
            url = supabase.storage.from_(BUCKET).get_public_url(path)
            public_urls.append(url)
        except Exception as exc:
            print(f"    Storage upload error (photo {idx}): {exc}")

    return public_urls


# ── Step 5: write back to societies row ───────────────────────────────────────
def update_society(society_id: int, place_id: str, coords: list[float] | None, image_urls: list[str]) -> None:
    payload: dict = {"place_id": place_id}
    if coords:
        payload["latitude"], payload["longitude"] = coords
    if image_urls:
        payload["image_urls"] = image_urls
    supabase.table("societies").update(payload).eq("id", society_id).execute()


# ── main ───────────────────────────────────────────────────────────────────────
def main() -> None:
    section("SOCIETY ENRICHMENT (Google Places)")

    if DRY_RUN:
        print()
        print("  *** DRY RUN — searches only, no download/upload/write ***")
    if FORCE:
        print()
        print("  --force: re-fetching all societies regardless of existing place_id")

    print()
    print("  Loading societies…")
    societies = get_societies()
    total_found = len(societies)

    if LIMIT is not None:
        societies = societies[:LIMIT]

    print(f"  Societies needing enrichment : {total_found}")
    if LIMIT is not None:
        print(f"  --limit {LIMIT}: processing {len(societies)}")

    if not societies:
        print()
        print("  Nothing to process. Use --force to re-fetch already-enriched societies.")
        return

    stats = {"stored": 0, "photos_total": 0, "no_match": 0, "failed": 0, "text_reqs": 0, "photo_reqs": 0}

    print()
    for row in societies:
        name = row["name"]
        locality = row.get("locality")
        city = row.get("city", "gurgaon")
        listing_count = row.get("listing_count", 0)

        try:
            place_id, google_name, photo_refs, coords = text_search_society(name, locality, city)
            stats["text_reqs"] += 1

            if not place_id:
                print(f"  ✗ {name} ({locality}) → no confident match, skipped")
                stats["no_match"] += 1
                time.sleep(SLEEP_BETWEEN)
                continue

            confidence = match_confidence(name, google_name)

            if DRY_RUN:
                print(
                    f"  [dry-run] {name} ({locality}) → place_id={place_id!r} "
                    f"google={google_name!r} coords={coords} photos={len(photo_refs)} [{confidence}]"
                )
                stats["stored"] += 1
                time.sleep(SLEEP_BETWEEN)
                continue

            image_urls: list[str] = []
            if photo_refs:
                stats["photo_reqs"] += len(photo_refs)
                image_urls = upload_photos(place_id, photo_refs)

            update_society(row["id"], place_id, coords, image_urls)

            print(
                f"  ✓ {name} ({locality}) → place_id set, "
                f"{len(image_urls)} photo(s), coords={'yes' if coords else 'no'} [{confidence}]"
            )
            stats["stored"] += 1
            stats["photos_total"] += len(image_urls)

        except Exception as exc:
            print(f"  ✗ {name} → ERROR: {exc}")
            stats["failed"] += 1

        time.sleep(SLEEP_BETWEEN)

    section("Summary")
    print(f"  Societies eligible           : {total_found}")
    print(f"  Processed                    : {len(societies)}")
    if DRY_RUN:
        print(f"  Would enrich                 : {stats['stored']}")
    else:
        print(f"  Successfully enriched        : {stats['stored']}")
        print(f"  Total photos uploaded        : {stats['photos_total']}")
    print(f"  Skipped (no confident match) : {stats['no_match']}")
    print(f"  Failed (error)                : {stats['failed']}")
    print()
    text_cost = stats["text_reqs"] * TEXTSEARCH_COST
    photo_cost = stats["photo_reqs"] * PHOTO_COST
    print(f"  Estimated API cost:")
    print(f"    Text Search : ${TEXTSEARCH_COST:.3f}/req × {stats['text_reqs']} = ${text_cost:.4f}")
    print(f"    Photo       : ${PHOTO_COST:.3f}/req × {stats['photo_reqs']} = ${photo_cost:.4f}")
    print(f"    Total       : ${text_cost + photo_cost:.4f}")
    if DRY_RUN:
        print()
        print("  *** DRY RUN — nothing was downloaded, uploaded, or written ***")
    print()


if __name__ == "__main__":
    main()
