#!/usr/bin/env python3
"""
enrich_geocode_reddit.py — Geocode Reddit listings that have no coordinates.

Resolution order per listing:

  Step 1 – address geocode (Google Geocoding API)
    Requires: address column is populated AND GOOGLE_PLACES_API_KEY is set.
    Query:  "<address>, Bangalore"
    Writes: geocode_source = 'address_geocode', geocode_confidence = 'medium'

  Step 2 – locality centroid fallback
    Requires: locality column matches a known locality in LOCALITY_META.
    Writes: geocode_source = 'locality_centroid', geocode_confidence = 'low'

Usage:
    python3 scripts/enrich_geocode_reddit.py
    python3 scripts/enrich_geocode_reddit.py --dry-run
    python3 scripts/enrich_geocode_reddit.py --limit 20
    python3 scripts/enrich_geocode_reddit.py --dry-run --limit 10
"""

from __future__ import annotations

import argparse
import os
import sys
import time
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
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2 not installed.  Run: pip install psycopg2-binary")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("ERROR: requests not installed.  Run: pip install requests")
    sys.exit(1)

# ── Load centroids from localities.py ─────────────────────────────────────────
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
try:
    from localities import LOCALITY_META, LOCALITY_ALIASES
except ImportError:
    print("ERROR: Could not import localities.py from backend/.")
    sys.exit(1)

# ── CLI ────────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(
    description="Geocode Reddit listings with null latitude"
)
parser.add_argument("--dry-run", action="store_true",
                    help="Compute and print results without writing to DB")
parser.add_argument("--limit",   type=int, default=None, metavar="N",
                    help="Process at most N listings")
args = parser.parse_args()

DRY_RUN: bool = args.dry_run
LIMIT:   int | None = args.limit

# ── Config ─────────────────────────────────────────────────────────────────────
GOOGLE_API_KEY: str = os.environ.get("GOOGLE_PLACES_API_KEY", "")
GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
GEOCODE_SLEEP = 0.2   # seconds between Google API calls (5 req/s stays well under free quota)

# ── DB ─────────────────────────────────────────────────────────────────────────
def get_conn():
    url = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL", "")
    if not url:
        print("ERROR: SUPABASE_DB_URL / DATABASE_URL is not set.")
        sys.exit(1)
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return psycopg2.connect(url)


# ── Geocoding ──────────────────────────────────────────────────────────────────
def geocode_address(address: str) -> tuple[float, float] | None:
    """
    Call the Google Geocoding API for '<address>, Bangalore'.
    Returns (lat, lng) on success, None on failure / no result.
    """
    if not GOOGLE_API_KEY:
        return None
    query = f"{address.strip()}, Bangalore"
    try:
        resp = requests.get(
            GEOCODE_URL,
            params={"address": query, "key": GOOGLE_API_KEY, "region": "in"},
            timeout=8,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") == "OK" and data.get("results"):
            loc = data["results"][0]["geometry"]["location"]
            return float(loc["lat"]), float(loc["lng"])
        if data.get("status") not in ("ZERO_RESULTS",):
            print(f"    Geocode API status: {data.get('status')} for: {query!r}")
    except Exception as exc:
        print(f"    Geocode request error: {exc}")
    return None


def centroid_for_locality(locality: str) -> tuple[float, float] | None:
    """
    Look up the centroid for a locality name using the canonical alias map.
    Returns (lat, lng) or None.
    """
    if not locality:
        return None
    meta = LOCALITY_META.get(locality)
    if not meta:
        canonical = LOCALITY_ALIASES.get(locality.strip().lower())
        if canonical:
            meta = LOCALITY_META.get(canonical)
    if meta:
        coords = meta["coords"]
        return float(coords[0]), float(coords[1])
    return None


# ── helpers ────────────────────────────────────────────────────────────────────
WIDTH = 60

def section(title: str) -> None:
    print()
    print("─" * WIDTH)
    print(f"  {title}")
    print("─" * WIDTH)


# ── main ───────────────────────────────────────────────────────────────────────
def main() -> None:
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM listings WHERE source='reddit';")
    total_src: int = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM listings WHERE source='reddit' AND latitude IS NULL;")
    total_null: int = cur.fetchone()[0]

    limit_clause = f"LIMIT {LIMIT}" if LIMIT is not None else ""
    cur.execute(f"""
        SELECT id, address, locality
        FROM   listings
        WHERE  source    = 'reddit'
          AND  latitude  IS NULL
        ORDER  BY id
        {limit_clause};
    """)
    rows = cur.fetchall()

    section("REDDIT GEOCODING ENRICHMENT")
    print(f"  Total reddit rows           : {total_src:,}")
    print(f"  Rows missing coordinates    : {total_null:,}")
    print(f"  Rows to process             : {len(rows):,}")
    if not GOOGLE_API_KEY:
        print()
        print("  NOTE: GOOGLE_PLACES_API_KEY not set — address geocoding disabled.")
        print("        Only locality centroid fallback will be used.")
    if DRY_RUN:
        print()
        print("  *** DRY RUN — no writes will be made ***")

    # ── Per-row resolution ─────────────────────────────────────────────────────
    stats = {
        "address_geocoded": 0,
        "centroid_fallback": 0,
        "unresolved": 0,
    }

    updates: list[tuple] = []   # (lat, lng, geocode_source, geocode_confidence, id)

    for listing_id, address, locality in rows:
        lat = lng = None
        geocode_source = geocode_confidence = None

        # Step 1 — address geocode
        has_address = bool(address and address.strip())
        if has_address and GOOGLE_API_KEY:
            result = geocode_address(address)
            if result:
                lat, lng = result
                geocode_source = "address_geocode"
                geocode_confidence = "medium"
                stats["address_geocoded"] += 1
                if DRY_RUN:
                    print(f"  [address]   id={listing_id}  {address[:50]!r}")
                    print(f"               → {lat:.6f}, {lng:.6f}")
            time.sleep(GEOCODE_SLEEP)

        # Step 2 — locality centroid fallback
        if lat is None:
            result = centroid_for_locality(locality)
            if result:
                lat, lng = result
                geocode_source = "locality_centroid"
                geocode_confidence = "low"
                stats["centroid_fallback"] += 1
                if DRY_RUN:
                    print(f"  [centroid]  id={listing_id}  locality={locality!r}")
                    print(f"               → {lat:.6f}, {lng:.6f}")

        if lat is None:
            stats["unresolved"] += 1
            if DRY_RUN:
                print(f"  [unresolved] id={listing_id}  address={address!r}  locality={locality!r}")
            continue

        updates.append((lat, lng, geocode_source, geocode_confidence, listing_id))

    # ── Write ──────────────────────────────────────────────────────────────────
    written = 0
    if not DRY_RUN and updates:
        psycopg2.extras.execute_batch(
            cur,
            """
            UPDATE listings SET
                latitude           = %s,
                longitude          = %s,
                geocode_source     = %s,
                geocode_confidence = %s
            WHERE id = %s;
            """,
            updates,
            page_size=100,
        )
        conn.commit()
        written = len(updates)

    # ── Summary ────────────────────────────────────────────────────────────────
    section("Summary")
    print(f"  Rows processed              : {len(rows):,}")
    print(f"  Address geocoded            : {stats['address_geocoded']:,}"
          f"  (geocode_source=address_geocode, confidence=medium)")
    print(f"  Locality centroid fallback  : {stats['centroid_fallback']:,}"
          f"  (geocode_source=locality_centroid, confidence=low)")
    print(f"  Unresolved                  : {stats['unresolved']:,}"
          f"  (no address or locality match)")
    if DRY_RUN:
        print(f"  Would have been written     : {len(updates):,}")
        print()
        print("  *** DRY RUN — nothing written ***")
    else:
        print(f"  Written to DB               : {written:,}")
    print()
    print("─" * WIDTH)
    print("  Done.")
    print()

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
