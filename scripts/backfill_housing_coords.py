#!/usr/bin/env python3
"""
backfill_housing_coords.py — Backfill latitude/longitude for Housing.com listings
that currently have null coordinates.

Strategy:
  1. Find all distinct localities that have housing rows with latitude IS NULL.
  2. For each locality, re-query the Housing.com GQL search endpoint (same one
     used during ingestion) — now requesting the `coords` field.
  3. Match returned listings by listingId to existing DB rows.
  4. Write latitude, longitude, geocode_source='original', geocode_confidence='high'.

Usage:
    python3 scripts/backfill_housing_coords.py
    python3 scripts/backfill_housing_coords.py --dry-run
    python3 scripts/backfill_housing_coords.py --limit 5
    python3 scripts/backfill_housing_coords.py --dry-run --limit 3
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

# ── env ────────────────────────────────────────────────────────────────────────
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
except ImportError:
    print("ERROR: psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. Run: pip install requests")
    sys.exit(1)

# ── CLI ────────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="Backfill Housing.com coordinates from GQL API")
parser.add_argument("--dry-run", action="store_true", help="Fetch and match but do not write to DB")
parser.add_argument("--limit",   type=int, default=None, metavar="N", help="Process at most N localities")
args = parser.parse_args()

DRY_RUN: bool = args.dry_run
LIMIT:   int | None = args.limit

# ── GQL config (mirrors ingest_housing.py exactly) ────────────────────────────
_GQL_URL = "https://mightyzeus-mum.housing.com/api/gql/stale"
_GQL_PARAMS = {
    "apiName": "SEARCH_RESULTS", "emittedFrom": "client_rent_SRP",
    "isBot": "false", "platform": "desktop",
    "source": "web", "source_name": "AudienceWeb",
}
_GQL_HEADERS = {
    "Content-Type": "application/json;charset=UTF-8",
    "Origin": "https://housing.com",
    "Referer": "https://housing.com/",
    "app-name": "desktop_web_buyer",
    "phoenix-api-name": "SEARCH_RESULTS",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
}
_GQL_QUERY = """
query SEARCH_RESULTS($hash: String!, $service: String!, $category: String!,
    $city: CityInput!, $pageTypeMajor: String, $pageInfo: PageInfoInput) {
  searchResults(
    hash: $hash, service: $service, category: $category,
    city: $city, pageTypeMajor: $pageTypeMajor, pageInfo: $pageInfo
  ) {
    properties {
      listingId
      coords
    }
  }
}
"""
_CITY_PAYLOAD = {
    "name": "Bengaluru", "id": "d94a0854185332e78d1b",
    "cityId": "747be13fe47cb8ae14c3", "url": "bangalore",
    "isTierTwo": False,
    "products": ["paying_guest", "buy", "plots", "commercial", "flatmate", "rent"],
}
_FALLBACK_HASHES: dict[str, str] = {
    "Whitefield":      "P4ie9y33s0tezykdb",
    "HSR Layout":      "P5kgp2umse63qjm62",
    "Koramangala":     "P5s2sntlyr4a7izpb",
    "Indiranagar":     "Pu0r6m95i80gbhpp",
    "Marathahalli":    "P19pr5xnbnbzon4fz",
    "Bellandur":       "P29di09q225s3j6s1",
    "BTM Layout":      "P3narpkd53st96zbh",
    "Hebbal":          "P5l2wlmnjhlmap6sy",
    "Electronic City": "P16rl894c0qkogx5",
    "Sarjapur Road":   "P1zr02w1owlhq796j",
    "Jayanagar":       "P5vem1jmqfgn3h0vo",
    "JP Nagar":        "P3yqqmgmdvlqoqz0n",
    "Hoodi":           "P4ojovmv8p4us9qur",
    "Yelahanka":       "P5p7bw7u4wfjpda1c",
    "Bannerghatta":    "P2t62bcbf3206th63",
    "Banaswadi":       "P2nfgxlm3u7k6uem6",
    "KR Puram":        "P5ldjyvluv8dq34ho",
    "Bommanahalli":    "P33hbx76231t7ltgp",
    "Banashankari":    "P613h1wbcuq4zmutv",
    "Rajajinagar":     "P1frh56o8juaeivr4",
    "Malleshwaram":    "P53twp7mtetscn6n9",
    "Yeshwanthpur":    "P65u9vd8ee6bzv463",
    "HBR Layout":      "P4gcpc5y1rpweuym0",
}
SLEEP_BETWEEN_LOCALITIES = 1.0

# ── DB ─────────────────────────────────────────────────────────────────────────
def get_conn():
    url = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL", "")
    if not url:
        print("ERROR: SUPABASE_DB_URL / DATABASE_URL is not set.")
        sys.exit(1)
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return psycopg2.connect(url)

# ── GQL fetch ──────────────────────────────────────────────────────────────────
def fetch_coords_for_locality(locality: str, hash_val: str) -> dict[str, tuple[float, float]]:
    """
    Returns {listingId: (lat, lng)} for every property returned by the search,
    skipping entries where coords is null or malformed.
    Paginates through all pages (page size 50) until no results.
    """
    result: dict[str, tuple[float, float]] = {}
    page = 1

    while True:
        variables = {
            "hash": hash_val,
            "service": "rent",
            "category": "residential",
            "city": _CITY_PAYLOAD,
            "pageTypeMajor": "SRP",
            "pageInfo": {"page": page, "size": 50},
        }
        try:
            resp = requests.post(
                _GQL_URL,
                params=_GQL_PARAMS,
                headers=_GQL_HEADERS,
                json={"query": _GQL_QUERY, "variables": json.dumps(variables)},
                timeout=12,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            print(f"    WARNING: GQL request failed (page {page}): {exc}")
            break

        if "errors" in data:
            print(f"    WARNING: GQL errors: {data['errors']}")
            break

        properties = (
            data.get("data", {})
                .get("searchResults", {})
                .get("properties") or []
        )
        if not properties:
            break  # no more pages

        for prop in properties:
            lid = str(prop.get("listingId", "")).strip()
            coords = prop.get("coords") or []
            if lid and len(coords) >= 2:
                try:
                    result[lid] = (float(coords[0]), float(coords[1]))
                except (ValueError, TypeError):
                    pass

        if len(properties) < 50:
            break  # last page
        page += 1

    return result


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

    # ── Step 1: localities that still need coords ──────────────────────────────
    cur.execute("""
        SELECT locality, COUNT(*) AS null_count
        FROM   listings
        WHERE  source    = 'housing'
          AND  latitude  IS NULL
          AND  locality  IS NOT NULL
        GROUP  BY locality
        ORDER  BY null_count DESC;
    """)
    locality_rows = cur.fetchall()

    cur.execute("SELECT COUNT(*) FROM listings WHERE source = 'housing' AND latitude IS NULL;")
    total_null = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM listings WHERE source = 'housing';")
    total_housing = cur.fetchone()[0]

    section("HOUSING.COM COORDINATE BACKFILL")
    print(f"  Total housing rows          : {total_housing:,}")
    print(f"  Rows missing coordinates    : {total_null:,}")
    print(f"  Distinct localities to query: {len(locality_rows)}")
    if DRY_RUN:
        print()
        print("  *** DRY RUN — no writes will be made ***")

    # Filter to localities we have a hash for; warn on unknowns
    workable: list[tuple[str, str, int]] = []
    no_hash:  list[str] = []
    for locality, null_count in locality_rows:
        h = _FALLBACK_HASHES.get(locality)
        if h:
            workable.append((locality, h, null_count))
        else:
            no_hash.append(locality)

    if no_hash:
        print()
        print(f"  Localities with no hash ({len(no_hash)}) — will be skipped:")
        for loc in no_hash:
            print(f"    • {loc}")

    if LIMIT is not None:
        workable = workable[:LIMIT]
        print()
        print(f"  --limit {LIMIT}: processing {len(workable)} locality/ies")

    # ── Step 2: per-locality fetch + match + update ────────────────────────────
    stats = {
        "localities_queried": 0,
        "api_listings_seen":  0,
        "matched":            0,
        "updated":            0,
        "no_coords_in_api":   0,
        "not_found_in_api":   0,
    }

    for locality, hash_val, null_count in workable:
        print()
        print(f"  [{locality}]  {null_count} null row(s)  hash={hash_val}")

        # Fetch all current listings for this locality from the API
        api_coords = fetch_coords_for_locality(locality, hash_val)
        stats["localities_queried"] += 1
        stats["api_listings_seen"]  += len(api_coords)
        print(f"    API returned {len(api_coords)} listings with coords")

        # Fetch DB rows for this locality that still need coords
        cur.execute("""
            SELECT id, source_id
            FROM   listings
            WHERE  source    = 'housing'
              AND  locality  = %s
              AND  latitude  IS NULL;
        """, (locality,))
        db_rows = cur.fetchall()

        matched_ids: list[tuple] = []  # (db_id, lat, lng)
        not_found:   list[str]   = []

        for db_id, source_id in db_rows:
            if source_id in api_coords:
                lat, lng = api_coords[source_id]
                matched_ids.append((db_id, lat, lng))
                stats["matched"] += 1
            else:
                not_found.append(source_id)
                stats["not_found_in_api"] += 1

        stats["no_coords_in_api"] += len(db_rows) - len(matched_ids) - len(not_found)

        print(f"    DB null rows : {len(db_rows)}")
        print(f"    Matched      : {len(matched_ids)}")
        print(f"    Not in API   : {len(not_found)}")

        if DRY_RUN:
            for db_id, lat, lng in matched_ids[:3]:
                print(f"      [dry-run] id={db_id} → lat={lat}, lng={lng}")
            if len(matched_ids) > 3:
                print(f"      [dry-run] … +{len(matched_ids) - 3} more")
        else:
            if matched_ids:
                psycopg2.extras.execute_batch(
                    cur,
                    """
                    UPDATE listings SET
                        latitude           = %s,
                        longitude          = %s,
                        geocode_source     = 'original',
                        geocode_confidence = 'high'
                    WHERE id = %s;
                    """,
                    [(lat, lng, db_id) for db_id, lat, lng in matched_ids],
                    page_size=100,
                )
                conn.commit()
                stats["updated"] += len(matched_ids)
                print(f"    Written      : {len(matched_ids)}")

        time.sleep(SLEEP_BETWEEN_LOCALITIES)

    # ── Summary ────────────────────────────────────────────────────────────────
    section("Summary")
    print(f"  Localities queried          : {stats['localities_queried']}")
    print(f"  API listings seen (total)   : {stats['api_listings_seen']:,}")
    print(f"  DB rows matched to API      : {stats['matched']:,}")
    if DRY_RUN:
        print(f"  Would have been updated     : {stats['matched']:,}")
    else:
        print(f"  Rows updated in DB          : {stats['updated']:,}")
    print(f"  Not found in current API    : {stats['not_found_in_api']:,}  "
          f"(listing removed from platform)")
    if DRY_RUN:
        print()
        print("  *** DRY RUN — nothing written ***")
    print()
    print("─" * WIDTH)
    print("  Done.")
    print()

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
