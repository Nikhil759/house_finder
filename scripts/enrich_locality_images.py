#!/usr/bin/env python3
"""
enrich_locality_images.py — Fetch a hero image for each Bangalore locality
and store it in Supabase Storage, then upsert metadata into locality_images.

Steps per locality:
  1. Text Search (Google Places) to find a photo_reference
  2. Photo API to download the actual image bytes
  3. Upload to Supabase Storage  →  localities/{slug}.jpg
  4. Upsert into locality_images table

Usage:
    python3 scripts/enrich_locality_images.py
    python3 scripts/enrich_locality_images.py --dry-run
    python3 scripts/enrich_locality_images.py --force
    python3 scripts/enrich_locality_images.py --limit 10
    python3 scripts/enrich_locality_images.py --dry-run --limit 5
    python3 scripts/enrich_locality_images.py --whitelist
    python3 scripts/enrich_locality_images.py --whitelist --dry-run
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timezone
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
    description="Fetch locality hero images from Google Places and store in Supabase"
)
parser.add_argument(
    "--dry-run", action="store_true",
    help="Run Places search and log what would be stored, skip download and upload",
)
parser.add_argument(
    "--force", action="store_true",
    help="Re-fetch even localities cached within the last 30 days",
)
parser.add_argument(
    "--limit", type=int, default=None, metavar="N",
    help="Process at most N localities",
)
parser.add_argument(
    "--whitelist", action="store_true",
    help="Skip DB locality query and process only the hardcoded canonical whitelist",
)
args = parser.parse_args()

DRY_RUN:   bool = args.dry_run
FORCE:     bool = args.force
LIMIT:     int | None = args.limit
WHITELIST: bool = args.whitelist

WHITELIST_LOCALITIES: list[str] = [
    "Electronic City", "BTM Layout", "HSR Layout", "Whitefield",
    "Indiranagar", "Bellandur", "Marathahalli", "JP Nagar",
    "Koramangala", "Hoodi", "Rajajinagar", "Sarjapur Road",
    "Banashankari", "Jayanagar", "Malleshwaram", "KR Puram",
    "Yelahanka", "Banaswadi", "Hebbal", "Yeshwanthpur",
    "Bommanahalli", "HBR Layout", "Bannerghatta", "Kalyan Nagar",
    "Doddakannelli", "Thanisandra", "Krishnarajapura", "Gottigere",
    "Thubarahalli", "MG Road", "Kasturi Nagar", "Kadubeesanahalli",
    "Peenya", "Cunningham Road", "Kadugodi", "Vijayanagar",
    "Mahadevapura", "Domlur", "RT Nagar", "Hennur",
    "CV Raman Nagar", "Varthur", "Madiwala", "Brookefield",
    "Basavanagudi", "Vidyaranyapura", "Subramanyapura",
]

# ── Config ─────────────────────────────────────────────────────────────────────
SUPABASE_URL:  str = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY:  str = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY", "")
GOOGLE_API_KEY: str = os.environ.get("GOOGLE_PLACES_API_KEY", "")
BUCKET = "nestiq-images"
CACHE_DAYS = 30
SLEEP_BETWEEN = 0.5       # seconds between locality calls
OVER_LIMIT_SLEEP = 5.0    # seconds to wait on OVER_QUERY_LIMIT

TEXTSEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"
PHOTO_URL      = "https://maps.googleapis.com/maps/api/place/photo"

TEXTSEARCH_COST = 0.017   # USD per request
PHOTO_COST      = 0.007   # USD per request

# ── Validate config ────────────────────────────────────────────────────────────
_missing = [v for v, k in [
    (SUPABASE_URL, "SUPABASE_URL"),
    (SUPABASE_KEY, "SUPABASE_KEY"),
    (GOOGLE_API_KEY, "GOOGLE_PLACES_API_KEY"),
] if not v]
if _missing:
    # recheck with names
    missing_names = []
    if not SUPABASE_URL:
        missing_names.append("SUPABASE_URL")
    if not SUPABASE_KEY:
        missing_names.append("SUPABASE_KEY")
    if not GOOGLE_API_KEY:
        missing_names.append("GOOGLE_PLACES_API_KEY")
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


def locality_slug(locality: str) -> str:
    return locality.lower().strip().replace(" ", "-")


# ── Step 1: get localities to process ─────────────────────────────────────────
def get_localities() -> list[str]:
    """Return localities to process.

    When --whitelist is set, use the hardcoded canonical list instead of
    querying the DB. Cache-skipping logic (--force / 30-day window) still applies.
    """
    if WHITELIST:
        all_localities = list(WHITELIST_LOCALITIES)
    else:
        resp = (
            supabase.table("listings")
            .select("locality")
            .neq("locality", None)
            .execute()
        )
        if not resp.data:
            return []

        all_localities = sorted(
            {row["locality"] for row in resp.data if row.get("locality")}
        )

    if FORCE:
        return all_localities

    # Fetch recently cached localities (within CACHE_DAYS)
    cutoff = datetime.now(timezone.utc).isoformat()
    cached_resp = (
        supabase.table("locality_images")
        .select("locality, fetched_at")
        .execute()
    )
    cached_set: set[str] = set()
    if cached_resp.data:
        from datetime import timedelta
        threshold = datetime.now(timezone.utc) - timedelta(days=CACHE_DAYS)
        for row in cached_resp.data:
            fetched_str = row.get("fetched_at")
            if not fetched_str:
                continue
            try:
                # Parse ISO format timestamp
                fetched_at_str = fetched_str.replace("Z", "+00:00")
                fetched_dt = datetime.fromisoformat(fetched_at_str)
                if fetched_dt.tzinfo is None:
                    fetched_dt = fetched_dt.replace(tzinfo=timezone.utc)
                if fetched_dt >= threshold:
                    cached_set.add(row["locality"])
            except (ValueError, TypeError):
                pass

    return [loc for loc in all_localities if loc not in cached_set]


# ── Step 2: text search ─────────────────────────────────────────────────────────
def text_search(query: str) -> tuple[str | None, str | None, str | None]:
    """
    Run a Google Places Text Search.
    Returns (place_id, name, photo_reference) or (None, None, None).
    Handles OVER_QUERY_LIMIT with one retry after a sleep.
    """
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
            return None, None, None

        status = data.get("status")

        if status == "OVER_QUERY_LIMIT":
            if attempt == 0:
                print(f"    OVER_QUERY_LIMIT — sleeping {OVER_LIMIT_SLEEP}s and retrying…")
                time.sleep(OVER_LIMIT_SLEEP)
                continue
            else:
                print("    OVER_QUERY_LIMIT on retry — skipping")
                return None, None, None

        if status != "OK":
            if status != "ZERO_RESULTS":
                print(f"    Text Search status: {status!r} for query: {query!r}")
            return None, None, None

        results = data.get("results", [])
        if not results:
            return None, None, None

        place = results[0]
        place_id = place.get("place_id")
        name = place.get("name")
        photos = place.get("photos", [])
        photo_ref = photos[0].get("photo_reference") if photos else None
        return place_id, name, photo_ref

    return None, None, None


def find_photo_reference(locality: str) -> tuple[str | None, str | None, str | None]:
    """
    Try two queries to find a photo_reference for the locality.
    Returns (place_id, name, photo_reference).
    """
    # Primary query
    place_id, name, photo_ref = text_search(f"{locality} Bangalore neighbourhood")
    if photo_ref:
        return place_id, name, photo_ref

    # Fallback query
    place_id, name, photo_ref = text_search(f"{locality} Bangalore")
    return place_id, name, photo_ref


# ── Step 3: fetch image ─────────────────────────────────────────────────────────
def fetch_image(photo_reference: str) -> tuple[bytes | None, str | None, tuple[int, int] | None]:
    """
    Download the image for a photo_reference.
    Returns (image_bytes, content_type, (width, height)) or (None, None, None).
    Follows the redirect automatically (requests does this by default).
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
        return None, None, None

    content_type = resp.headers.get("Content-Type", "")
    if not content_type.startswith("image/"):
        print(f"    Unexpected content-type: {content_type!r} — skipping")
        return None, None, None

    image_bytes = resp.content

    # Attempt to read dimensions using PIL if available
    dimensions: tuple[int, int] | None = None
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(image_bytes))
        dimensions = img.size  # (width, height)
    except Exception:
        pass  # PIL not available or unreadable — dimensions remain None

    return image_bytes, content_type, dimensions


# ── Step 4: upload to Supabase Storage ────────────────────────────────────────
def upload_to_storage(locality: str, image_bytes: bytes, content_type: str) -> str | None:
    """
    Upload image to Supabase Storage and return the public URL.
    """
    slug = locality_slug(locality)
    path = f"localities/{slug}.jpg"

    try:
        supabase.storage.from_(BUCKET).upload(
            path,
            image_bytes,
            file_options={
                "content-type": content_type,
                "upsert": "true",
            },
        )
    except Exception as exc:
        # supabase-py raises on non-2xx; try to surface a readable message
        print(f"    Storage upload error: {exc}")
        return None

    try:
        public_url = supabase.storage.from_(BUCKET).get_public_url(path)
        return public_url
    except Exception as exc:
        print(f"    Could not retrieve public URL: {exc}")
        return None


# ── Step 5: upsert into locality_images ───────────────────────────────────────
def upsert_locality_image(
    locality: str,
    place_id: str,
    image_url: str,
    photo_reference: str,
) -> None:
    fetched_at = datetime.now(timezone.utc).isoformat()
    supabase.table("locality_images").upsert(
        {
            "locality":        locality,
            "place_id":        place_id,
            "image_url":       image_url,
            "photo_reference": photo_reference,
            "fetched_at":      fetched_at,
        },
        on_conflict="locality",
    ).execute()


# ── main ───────────────────────────────────────────────────────────────────────
def main() -> None:
    section("LOCALITY IMAGE ENRICHMENT")

    if DRY_RUN:
        print()
        print("  *** DRY RUN — searches only, no download or upload ***")
    if WHITELIST:
        print()
        print(f"  --whitelist: using hardcoded canonical list ({len(WHITELIST_LOCALITIES)} localities)")
    if FORCE:
        print()
        print("  --force: re-fetching all localities regardless of cache")

    # ── Get work list ──────────────────────────────────────────────────────────
    print()
    print("  Loading localities from listings table…")
    try:
        localities = get_localities()
    except Exception as exc:
        print(f"ERROR: Could not load localities: {exc}")
        sys.exit(1)

    total_found = len(localities)

    if LIMIT is not None:
        localities = localities[:LIMIT]

    print(f"  Total distinct localities   : {total_found}")
    if LIMIT is not None:
        print(f"  --limit {LIMIT}: processing {len(localities)}")

    if not localities:
        print()
        print("  Nothing to process — all localities are up to date.")
        print("  Use --force to re-fetch cached localities.")
        return

    # ── Per-locality processing ────────────────────────────────────────────────
    stats = {
        "stored":    0,
        "no_photo":  0,
        "failed":    0,
        "text_reqs": 0,   # number of Text Search API calls made
        "photo_reqs": 0,  # number of Photo API calls made
    }

    print()
    for locality in localities:
        try:
            # Step 2 — find photo reference
            place_id, place_name, photo_ref = find_photo_reference(locality)
            # Each find_photo_reference call makes 1 or 2 text search requests
            # We count conservatively: 1 if found on first try, else 2
            stats["text_reqs"] += 1  # first query always made
            if not photo_ref:
                # second query was also attempted
                stats["text_reqs"] += 1
                print(f"  ✗ {locality} → no photo found, skipped")
                stats["no_photo"] += 1
                time.sleep(SLEEP_BETWEEN)
                continue

            if DRY_RUN:
                print(
                    f"  [dry-run] {locality} → place_id={place_id!r}  "
                    f"name={place_name!r}  photo_ref={photo_ref[:30]}…"
                )
                stats["stored"] += 1
                time.sleep(SLEEP_BETWEEN)
                continue

            # Step 3 — fetch the image bytes
            image_bytes, content_type, dimensions = fetch_image(photo_ref)
            stats["photo_reqs"] += 1

            if image_bytes is None:
                print(f"  ✗ {locality} → image download failed, skipped")
                stats["failed"] += 1
                time.sleep(SLEEP_BETWEEN)
                continue

            # Step 4 — upload to storage
            image_url = upload_to_storage(locality, image_bytes, content_type)
            if image_url is None:
                print(f"  ✗ {locality} → storage upload failed, skipped")
                stats["failed"] += 1
                time.sleep(SLEEP_BETWEEN)
                continue

            # Step 5 — upsert DB record
            upsert_locality_image(locality, place_id, image_url, photo_ref)

            dim_str = f"{dimensions[0]}x{dimensions[1]}" if dimensions else "?x?"
            print(f"  ✓ {locality} → stored ({dim_str})")
            stats["stored"] += 1

        except Exception as exc:
            print(f"  ✗ {locality} → ERROR: {exc}")
            stats["failed"] += 1

        time.sleep(SLEEP_BETWEEN)

    # ── Summary ────────────────────────────────────────────────────────────────
    section("Summary")
    print(f"  Total localities found      : {total_found}")
    print(f"  Processed                   : {len(localities)}")
    if DRY_RUN:
        print(f"  Would store                 : {stats['stored']}")
    else:
        print(f"  Successfully stored         : {stats['stored']}")
    print(f"  Skipped (no photo)          : {stats['no_photo']}")
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
