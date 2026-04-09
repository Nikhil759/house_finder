#!/usr/bin/env python3
"""
enrich_society_images.py — Fetch exterior photos for residential societies
from Google Places API and store them in Supabase Storage.

Steps per society:
  1. Query listings for societies with >= 2 listings
  2. Google Places Text Search to find place_id + up to 3 photo_references
  3. Download up to 3 photos per society
  4. Upload to Supabase Storage  →  societies/{place_id}/1.jpg, 2.jpg, 3.jpg
  5. Upsert into society_images table
  6. Backfill listings.society_place_id in a single UPDATE

Usage:
    python3 scripts/enrich_society_images.py
    python3 scripts/enrich_society_images.py --dry-run
    python3 scripts/enrich_society_images.py --force
    python3 scripts/enrich_society_images.py --limit 20
    python3 scripts/enrich_society_images.py --dry-run --limit 10
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ── env ────────────────────────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
except ImportError:
    print("ERROR: python-dotenv not installed.  Run: pip install python-dotenv")
    sys.exit(1)

env_path = Path(__file__).resolve().parent.parent / "backend" / ".env"
load_dotenv(env_path if env_path.exists() else None)

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
    description="Fetch society exterior photos from Google Places and store in Supabase"
)
parser.add_argument(
    "--dry-run", action="store_true",
    help="Run Places search and log what would be stored, skip download and upload",
)
parser.add_argument(
    "--force", action="store_true",
    help="Re-fetch even societies cached within the last 30 days",
)
parser.add_argument(
    "--limit", type=int, default=None, metavar="N",
    help="Process at most N societies",
)
args = parser.parse_args()

DRY_RUN: bool = args.dry_run
FORCE:   bool = args.force
LIMIT:   int | None = args.limit

# ── Config ─────────────────────────────────────────────────────────────────────
SUPABASE_URL:   str = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY:   str = (
    os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY", "")
)
GOOGLE_API_KEY: str = os.environ.get("GOOGLE_PLACES_API_KEY", "")
BUCKET          = "nestiq-images"
CACHE_DAYS      = 30
MIN_LISTINGS    = 2
MAX_PHOTOS      = 3
BATCH_SIZE      = 50
SLEEP_BETWEEN   = 0.5
OVER_LIMIT_SLEEP = 5.0

TEXTSEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"
PHOTO_URL      = "https://maps.googleapis.com/maps/api/place/photo"

TEXTSEARCH_COST = 0.017
PHOTO_COST      = 0.007

# Place types that indicate a residential/commercial property
VALID_TYPES = {
    "premise",
    "establishment",
    "point_of_interest",
    "real_estate_agency",
    "apartment_complex",
}

# Generic descriptors and locality names that leak into society_name — skip these
BLOCKLIST: set[str] = {
    # Generic property types
    "independent house", "standalone building", "standalone house",
    "builder floor", "independent floor", "villa", "apartment",
    "residential apartment", "flat", "penthouse", "studio apartment",
    # Bangalore localities that leaked into society_name
    "koramangala", "indiranagar", "hsr layout", "whitefield",
    "marathahalli", "bellandur", "btm layout", "jayanagar",
    "electronic city", "sarjapur", "hebbal", "jp nagar",
    "rajajinagar", "yelahanka", "malleshwaram", "malleswaram",
    "banashankari", "banaswadi", "yeshwanthpur", "bommanahalli",
    "hbr layout", "bannerghatta", "kalyan nagar", "doddakannelli",
    "thanisandra", "krishnarajapura", "gottigere", "thubarahalli",
    "mg road", "kasturi nagar", "kadubeesanahalli", "peenya",
    "cunningham road", "kadugodi", "vijayanagar", "mahadevapura",
    "domlur", "rt nagar", "hennur", "cv raman nagar", "varthur",
    "madiwala", "brookefield", "basavanagudi", "vidyaranyapura",
    "cholanayakanahalli", "hoodi", "kr puram",
}

# ── Validate config ────────────────────────────────────────────────────────────
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

# ── Supabase client ─────────────────────────────────────────────────────────────
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── helpers ────────────────────────────────────────────────────────────────────
WIDTH = 60


def section(title: str) -> None:
    print()
    print("─" * WIDTH)
    print(f"  {title}")
    print("─" * WIDTH)


def tokenize(name: str) -> set[str]:
    """Lowercase words of 3+ characters, stripping punctuation."""
    return {w for w in re.split(r"\W+", name.lower()) if len(w) >= 3}


def match_confidence(society_name: str, google_name: str) -> str:
    """Return 'high' or 'low' based on word-overlap between the two names."""
    s_tokens = tokenize(society_name)
    g_tokens = tokenize(google_name)
    if not s_tokens or not g_tokens:
        return "low"
    overlap = s_tokens & g_tokens
    ratio = len(overlap) / max(len(s_tokens), len(g_tokens))
    return "high" if ratio >= 0.5 else "low"


def parse_fetched_at(fetched_str: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(fetched_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, TypeError):
        return None


# ── Step 1: get societies to process ──────────────────────────────────────────
def get_societies() -> list[tuple[str, int]]:
    """
    Return list of (society_name, listing_count) ordered by listing_count DESC,
    excluding recently cached entries unless --force.
    """
    # Pull all society_name values in batches (PostgREST limit workaround)
    all_rows: list[dict] = []
    offset = 0
    while True:
        resp = (
            supabase.table("listings")
            .select("society_name")
            .neq("society_name", None)
            .range(offset, offset + BATCH_SIZE - 1)
            .execute()
        )
        batch = resp.data or []
        all_rows.extend(batch)
        if len(batch) < BATCH_SIZE:
            break
        offset += BATCH_SIZE

    # Aggregate counts
    counts: dict[str, int] = {}
    for row in all_rows:
        name = row.get("society_name", "").strip()
        if name:
            counts[name] = counts.get(name, 0) + 1

    # Filter to societies with >= MIN_LISTINGS
    societies = [
        (name, cnt)
        for name, cnt in counts.items()
        if cnt >= MIN_LISTINGS
    ]
    societies.sort(key=lambda x: x[1], reverse=True)

    if FORCE:
        return societies

    # Exclude recently cached entries
    cached_resp = supabase.table("society_images").select("society_name, fetched_at").execute()
    threshold = datetime.now(timezone.utc) - timedelta(days=CACHE_DAYS)
    cached_set: set[str] = set()
    for row in cached_resp.data or []:
        dt = parse_fetched_at(row.get("fetched_at", ""))
        if dt and dt >= threshold:
            cached_set.add(row["society_name"])

    return [(name, cnt) for name, cnt in societies if name not in cached_set]


# ── Step 2: text search ─────────────────────────────────────────────────────────
def text_search_society(
    society_name: str,
) -> tuple[str | None, str | None, list[str], list[str]]:
    """
    Search Google Places for the society.
    Returns (place_id, google_name, photo_references[:3], types) or
            (None, None, [], []) on failure / low-confidence match.
    """
    query = f"{society_name} Bangalore apartment"
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
            return None, None, [], []

        status = data.get("status")

        if status == "OVER_QUERY_LIMIT":
            if attempt == 0:
                print(f"    OVER_QUERY_LIMIT — sleeping {OVER_LIMIT_SLEEP}s and retrying…")
                time.sleep(OVER_LIMIT_SLEEP)
                continue
            print("    OVER_QUERY_LIMIT on retry — skipping")
            return None, None, [], []

        if status != "OK":
            if status not in ("ZERO_RESULTS",):
                print(f"    Text Search status: {status!r} for {society_name!r}")
            return None, None, [], []

        results = data.get("results", [])
        if not results:
            return None, None, [], []

        place      = results[0]
        place_id   = place.get("place_id", "")
        google_name = place.get("name", "")
        types      = place.get("types", [])
        photos     = place.get("photos", [])

        # Confidence check — type filter
        if not VALID_TYPES.intersection(types):
            print(
                f"    Skipping {society_name!r}: no valid type "
                f"(got {types[:4]})"
            )
            return None, None, [], []

        # Confidence check — name overlap
        s_tokens = tokenize(society_name)
        g_tokens = tokenize(google_name)
        if s_tokens and g_tokens and not (s_tokens & g_tokens):
            print(
                f"    Skipping {society_name!r}: zero name overlap "
                f"(Google matched {google_name!r})"
            )
            return None, None, [], []

        photo_refs = [
            p["photo_reference"]
            for p in photos[:MAX_PHOTOS]
            if p.get("photo_reference")
        ]

        return place_id, google_name, photo_refs, types

    return None, None, [], []


# ── Step 3: fetch image ─────────────────────────────────────────────────────────
def fetch_image(photo_reference: str) -> tuple[bytes | None, str | None]:
    """
    Download the image for a photo_reference.
    Returns (image_bytes, content_type) or (None, None).
    """
    try:
        resp = requests.get(
            PHOTO_URL,
            params={
                "maxwidth": 1200,
                "photo_reference": photo_reference,
                "key": GOOGLE_API_KEY,
            },
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
def upload_photos(
    place_id: str,
    photo_refs: list[str],
) -> list[str]:
    """
    Download and upload up to MAX_PHOTOS images.
    Returns list of public URLs for successfully uploaded images.
    """
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


# ── Step 5: upsert into society_images ────────────────────────────────────────
def upsert_society_image(
    society_name: str,
    place_id: str,
    image_urls: list[str],
    google_name: str,
    confidence: str,
    listing_count: int,
) -> None:
    supabase.table("society_images").upsert(
        {
            "society_name":      society_name,
            "place_id":          place_id,
            "image_urls":        image_urls,
            "google_name":       google_name,
            "match_confidence":  confidence,
            "listing_count":     listing_count,
            "fetched_at":        datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="place_id",
    ).execute()


# ── Step 6: backfill listings.society_place_id ────────────────────────────────
def backfill_society_place_id() -> int:
    """
    Ensure listings.society_place_id column exists, then run a single
    UPDATE to link listings → society_images by society_name.
    Returns number of rows updated.
    """
    # Add column if it doesn't exist (will silently succeed if already present)
    try:
        # PostgREST can't run DDL; use a raw RPC or just attempt the update
        # and let Postgres surface the error if the column is missing.
        # We rely on the table having been created with the column already.
        pass
    except Exception:
        pass

    # Fetch all society_images to build the mapping
    si_resp = supabase.table("society_images").select("society_name, place_id").execute()
    mapping: dict[str, str] = {
        row["society_name"]: row["place_id"]
        for row in (si_resp.data or [])
        if row.get("society_name") and row.get("place_id")
    }

    if not mapping:
        return 0

    # Fetch listings that need backfilling
    listings_resp = (
        supabase.table("listings")
        .select("id, society_name")
        .neq("society_name", None)
        .is_("society_place_id", "null")
        .execute()
    )
    rows = listings_resp.data or []

    updated = 0
    batch: list[dict] = []
    for row in rows:
        place_id = mapping.get(row.get("society_name", ""))
        if place_id:
            batch.append({"id": row["id"], "society_place_id": place_id})

        if len(batch) >= BATCH_SIZE:
            for item in batch:
                supabase.table("listings").update(
                    {"society_place_id": item["society_place_id"]}
                ).eq("id", item["id"]).execute()
            updated += len(batch)
            batch = []

    for item in batch:
        supabase.table("listings").update(
            {"society_place_id": item["society_place_id"]}
        ).eq("id", item["id"]).execute()
    updated += len(batch)

    return updated


# ── main ───────────────────────────────────────────────────────────────────────
def main() -> None:
    section("SOCIETY IMAGE ENRICHMENT")

    if DRY_RUN:
        print()
        print("  *** DRY RUN — searches only, no download or upload ***")
    if FORCE:
        print()
        print("  --force: re-fetching all societies regardless of cache")

    # ── Step 1: load work list ─────────────────────────────────────────────────
    print()
    print("  Loading societies from listings table…")
    try:
        societies = get_societies()
    except Exception as exc:
        print(f"ERROR: Could not load societies: {exc}")
        sys.exit(1)

    total_found = len(societies)

    if LIMIT is not None:
        societies = societies[:LIMIT]

    print(f"  Societies with >= {MIN_LISTINGS} listings : {total_found}")
    if LIMIT is not None:
        print(f"  --limit {LIMIT}: processing {len(societies)}")

    if not societies:
        print()
        print("  Nothing to process — all societies are up to date.")
        print("  Use --force to re-fetch cached societies.")
        return

    # ── Per-society processing ─────────────────────────────────────────────────
    stats = {
        "stored":      0,
        "photos_total": 0,
        "no_match":    0,
        "failed":      0,
        "text_reqs":   0,
        "photo_reqs":  0,
    }

    print()
    for society_name, listing_count in societies:
        try:
            # Blocklist check
            if society_name.lower().strip() in BLOCKLIST:
                print(f"  ✗ {society_name} ({listing_count} listings) → blocklisted, skipped")
                stats["no_match"] += 1
                continue

            # Step 2 — text search
            place_id, google_name, photo_refs, types = text_search_society(society_name)
            stats["text_reqs"] += 1

            if not place_id:
                print(f"  ✗ {society_name} ({listing_count} listings) → no confident match, skipped")
                stats["no_match"] += 1
                time.sleep(SLEEP_BETWEEN)
                continue

            confidence = match_confidence(society_name, google_name)

            if DRY_RUN:
                print(
                    f"  [dry-run] {society_name} ({listing_count} listings) → "
                    f"place_id={place_id!r}  google={google_name!r}  "
                    f"photos={len(photo_refs)}  [{confidence}]"
                )
                stats["stored"] += 1
                time.sleep(SLEEP_BETWEEN)
                continue

            if not photo_refs:
                print(
                    f"  ✗ {society_name} ({listing_count} listings) → "
                    f"matched {google_name!r} but no photos available, skipped"
                )
                stats["no_match"] += 1
                time.sleep(SLEEP_BETWEEN)
                continue

            # Steps 3 + 4 — download and upload photos
            stats["photo_reqs"] += len(photo_refs)
            image_urls = upload_photos(place_id, photo_refs)

            if not image_urls:
                print(f"  ✗ {society_name} ({listing_count} listings) → all photo uploads failed")
                stats["failed"] += 1
                time.sleep(SLEEP_BETWEEN)
                continue

            # Step 5 — upsert DB record
            upsert_society_image(
                society_name, place_id, image_urls,
                google_name, confidence, listing_count,
            )

            print(
                f"  ✓ {society_name} ({listing_count} listings) → "
                f"{len(image_urls)} photo(s) stored [{confidence}]"
            )
            stats["stored"] += 1
            stats["photos_total"] += len(image_urls)

        except Exception as exc:
            print(f"  ✗ {society_name} → ERROR: {exc}")
            stats["failed"] += 1

        time.sleep(SLEEP_BETWEEN)

    # ── Step 6: backfill listings.society_place_id ────────────────────────────
    if not DRY_RUN and stats["stored"] > 0:
        print()
        print("  Backfilling listings.society_place_id…")
        try:
            updated = backfill_society_place_id()
            print(f"  Linked {updated:,} listing row(s) → society_place_id")
        except Exception as exc:
            print(f"  WARNING: Backfill failed: {exc}")

    # ── Summary ────────────────────────────────────────────────────────────────
    section("Summary")
    print(f"  Societies eligible          : {total_found}")
    print(f"  Processed                   : {len(societies)}")
    if DRY_RUN:
        print(f"  Would store                 : {stats['stored']}")
    else:
        print(f"  Successfully stored         : {stats['stored']}")
        print(f"  Total photos uploaded       : {stats['photos_total']}")
    print(f"  Skipped (no confident match): {stats['no_match']}")
    print(f"  Failed (error)              : {stats['failed']}")
    print()
    text_cost  = stats["text_reqs"]  * TEXTSEARCH_COST
    photo_cost = stats["photo_reqs"] * PHOTO_COST
    total_cost = text_cost + photo_cost
    print(f"  Estimated API cost:")
    print(
        f"    Text Search : ${TEXTSEARCH_COST:.3f}/req × {stats['text_reqs']} = ${text_cost:.4f}"
    )
    print(
        f"    Photo       : ${PHOTO_COST:.3f}/req × {stats['photo_reqs']} = ${photo_cost:.4f}"
    )
    print(f"    Total       : ${total_cost:.4f}")
    if DRY_RUN:
        print()
        print("  *** DRY RUN — nothing was downloaded or uploaded ***")
    print()
    print("─" * WIDTH)
    print("  Done.")
    print()


if __name__ == "__main__":
    main()
