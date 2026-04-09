#!/usr/bin/env python3
"""
extract_nobroker_payload.py — Backfill structured data for NoBroker listings
from their raw_payload column.

Extracted fields:
  society_name     — buildingName or society (comma-suffix stripped)
  image_urls       — up to 10 URLs from photos[].imagesMap.large
  latitude/longitude — from payload (only when DB row is currently null)
  geocode_source   = 'original'
  geocode_confidence = 'high'     (written only alongside coordinates)

New columns are created automatically if they don't exist yet.

Usage:
    python3 scripts/extract_nobroker_payload.py
    python3 scripts/extract_nobroker_payload.py --dry-run
    python3 scripts/extract_nobroker_payload.py --limit 50
    python3 scripts/extract_nobroker_payload.py --dry-run --limit 10
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

# ── env / deps ─────────────────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
except ImportError:
    print("ERROR: python-dotenv not installed. Run: pip install python-dotenv")
    sys.exit(1)

env_path = Path(__file__).resolve().parent.parent / "backend" / ".env"
load_dotenv(env_path if env_path.exists() else None)

try:
    import psycopg2
    import psycopg2.extras
    import psycopg2.extensions
except ImportError:
    print("ERROR: psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)

# ── constants ──────────────────────────────────────────────────────────────────
SOURCE = "nobroker"
BATCH_SIZE = 100
NB_IMAGE_BASE = "https://assets.nobroker.in/images"

# ── CLI args ───────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="Backfill NoBroker payload data into listings table")
parser.add_argument("--dry-run", action="store_true", help="Print changes without writing to DB")
parser.add_argument("--limit", type=int, default=None, metavar="N", help="Process at most N listings")
args = parser.parse_args()

DRY_RUN: bool = args.dry_run
LIMIT: int | None = args.limit


# ── connect ────────────────────────────────────────────────────────────────────
def get_conn():
    url = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL", "")
    if not url:
        print("ERROR: SUPABASE_DB_URL / DATABASE_URL is not set.")
        sys.exit(1)
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return psycopg2.connect(url)


# ── helpers ────────────────────────────────────────────────────────────────────
WIDTH = 58

def section(title: str) -> None:
    print()
    print("─" * WIDTH)
    print(f"  {title}")
    print("─" * WIDTH)


def parse_payload(raw) -> dict | None:
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


def extract_society(payload: dict) -> str | None:
    """
    Use buildingName first, fall back to society.
    Strip everything from the first comma onward (removes ', Locality' suffixes).
    """
    raw = payload.get("buildingName") or payload.get("society") or ""
    raw = raw.strip()
    if not raw:
        return None
    # Strip ', <locality>' suffix
    clean = re.split(r"\s*,\s*", raw)[0].strip()
    return clean if clean else None


def extract_image_urls(payload: dict, max_images: int = 10) -> list[str]:
    """
    Build image URLs from photos[].imagesMap.large (preferred) or .original.
    URL pattern: {NB_IMAGE_BASE}/{property_id}/{filename}
    """
    photos: list = payload.get("photos") or []
    if not isinstance(photos, list):
        return []

    property_id: str = str(payload.get("id", ""))
    urls: list[str] = []

    for photo in photos[:max_images]:
        if not isinstance(photo, dict):
            continue
        images_map: dict = photo.get("imagesMap") or {}
        filename: str = (
            images_map.get("large")
            or images_map.get("original")
            or images_map.get("medium")
            or ""
        )
        if not filename:
            continue
        if property_id:
            urls.append(f"{NB_IMAGE_BASE}/{property_id}/{filename}")
        else:
            # Filename already contains property_id as prefix
            urls.append(f"{NB_IMAGE_BASE}/{filename}")

    return urls


def extract_coords(payload: dict) -> tuple[float | None, float | None]:
    try:
        lat = float(payload["latitude"])
        lng = float(payload["longitude"])
        return lat, lng
    except (KeyError, TypeError, ValueError):
        return None, None


# ── schema migration ───────────────────────────────────────────────────────────
def ensure_columns(conn) -> None:
    """Add new columns to listings if they don't exist yet."""
    new_cols = [
        ("society_name",        "TEXT"),
        ("image_urls",          "TEXT[]"),
        ("geocode_source",      "TEXT"),
        ("geocode_confidence",  "TEXT"),
    ]
    cur = conn.cursor()
    for col, col_type in new_cols:
        cur.execute(f"""
            ALTER TABLE listings
            ADD COLUMN IF NOT EXISTS {col} {col_type};
        """)
    conn.commit()
    cur.close()


# ── main ───────────────────────────────────────────────────────────────────────
def main() -> None:
    conn = get_conn()

    if DRY_RUN:
        section("DRY RUN — no writes will be made")
    else:
        section("Ensuring new columns exist")
        ensure_columns(conn)
        print("  society_name, image_urls, geocode_source, geocode_confidence — OK")

    # Count totals
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM listings WHERE source = %s;", (SOURCE,))
    total_nb: int = cur.fetchone()[0]

    limit_clause = f"LIMIT {LIMIT}" if LIMIT is not None else ""
    cur.execute(f"""
        SELECT id, locality, latitude, longitude, raw_payload
        FROM   listings
        WHERE  source = %s
        ORDER  BY id
        {limit_clause};
    """, (SOURCE,))

    all_rows = cur.fetchall()
    cur.close()

    # Print first photo object to show structure (once)
    photo_structure_shown = False

    # Counters
    stats = {
        "processed":       0,
        "society_written": 0,
        "images_written":  0,
        "coords_written":  0,
        "fully_skipped":   0,
        "errors":          0,
    }

    section(f"Processing {len(all_rows):,} NoBroker listings (batch={BATCH_SIZE})")

    batch_updates: list[tuple] = []

    def flush_batch():
        if DRY_RUN or not batch_updates:
            return
        cur2 = conn.cursor()
        psycopg2.extras.execute_batch(
            cur2,
            """
            UPDATE listings SET
                society_name       = COALESCE(%s, society_name),
                image_urls         = COALESCE(%s, image_urls),
                latitude           = COALESCE(%s, latitude),
                longitude          = COALESCE(%s, longitude),
                geocode_source     = CASE WHEN %s IS NOT NULL THEN %s ELSE geocode_source END,
                geocode_confidence = CASE WHEN %s IS NOT NULL THEN %s ELSE geocode_confidence END
            WHERE id = %s;
            """,
            batch_updates,
            page_size=BATCH_SIZE,
        )
        conn.commit()
        cur2.close()
        batch_updates.clear()

    for row_idx, (listing_id, stored_locality, stored_lat, stored_lng, raw) in enumerate(all_rows):
        stats["processed"] += 1

        payload = parse_payload(raw)
        if payload is None:
            stats["errors"] += 1
            continue

        # ── society ────────────────────────────────────────────────────────────
        society = extract_society(payload)

        # ── images ─────────────────────────────────────────────────────────────
        if not photo_structure_shown:
            photos_raw = payload.get("photos") or []
            if photos_raw and isinstance(photos_raw, list):
                section("First photo object structure (for reference)")
                print(json.dumps(photos_raw[0], indent=4))
                photo_structure_shown = True

        image_urls = extract_image_urls(payload)

        # ── coordinates (only if DB row currently has no coords) ───────────────
        write_coords = False
        lat, lng = None, None
        if stored_lat is None and stored_lng is None:
            lat, lng = extract_coords(payload)
            if lat is not None and lng is not None:
                write_coords = True

        # ── skip check ─────────────────────────────────────────────────────────
        nothing_to_write = (
            society is None
            and not image_urls
            and not write_coords
        )
        if nothing_to_write:
            stats["fully_skipped"] += 1
            continue

        # ── dry-run output ─────────────────────────────────────────────────────
        if DRY_RUN:
            print(f"\n  id={listing_id}  locality={stored_locality}")
            if society:
                print(f"    society_name   → {society!r}")
            if image_urls:
                print(f"    image_urls     → {len(image_urls)} URLs")
                for u in image_urls[:2]:
                    print(f"      {u}")
                if len(image_urls) > 2:
                    print(f"      … +{len(image_urls) - 2} more")
            if write_coords:
                print(f"    lat/lng        → {lat}, {lng}  (geocode_source=original, confidence=high)")
        else:
            # Pack update params — see SQL above (9 placeholders)
            batch_updates.append((
                society,
                list(image_urls) if image_urls else None,
                lat if write_coords else None,
                lng if write_coords else None,
                lat if write_coords else None,   # geocode_source CASE
                "original" if write_coords else None,
                lat if write_coords else None,   # geocode_confidence CASE
                "high" if write_coords else None,
                listing_id,
            ))

        if society:
            stats["society_written"] += 1
        if image_urls:
            stats["images_written"] += 1
        if write_coords:
            stats["coords_written"] += 1

        if len(batch_updates) >= BATCH_SIZE:
            flush_batch()
            print(f"  … flushed batch at row {row_idx + 1:,}")

    flush_batch()

    # ── Summary ────────────────────────────────────────────────────────────────
    section("Summary")
    print(f"  Total NoBroker listings in DB : {total_nb:,}")
    if LIMIT:
        print(f"  Listings processed (--limit)  : {stats['processed']:,}")
    print(f"  society_name extracted        : {stats['society_written']:,}")
    print(f"  image_urls extracted          : {stats['images_written']:,}")
    print(f"  coordinates backfilled        : {stats['coords_written']:,}")
    print(f"  fully skipped (already set)   : {stats['fully_skipped']:,}")
    print(f"  parse errors                  : {stats['errors']:,}")
    if DRY_RUN:
        print()
        print("  *** DRY RUN — nothing written ***")
    print()
    print("─" * WIDTH)
    print("  Done.")
    print()

    conn.close()


if __name__ == "__main__":
    main()
