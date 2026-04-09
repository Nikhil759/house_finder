#!/usr/bin/env python3
"""
extract_housing_society.py — Backfill society_name for Housing.com listings
by parsing the first comma-segment of the stored address string.

Address format:  "Building Name, Area, Locality, City Zone, Bengaluru"

Skip rules (in order):
  1. Segment is shorter than 4 characters.
  2. Segment ends with a generic geographic suffix word:
     Layout, Road, Street, Main, Nagar, Colony, Extension, Village,
     Agrahara, Gardens, Garden.
  3. Segment matches an ordinal / structural area pattern:
     "Phase 1", "2nd Stage", "Sector 7", "4th Block", etc.
  4. Segment is a generic building descriptor:
     "Independent house / building / flat / room / floor".
  5. Segment is identical (case-insensitive) to the stored locality
     column — no building info was prepended.

Usage:
    python3 scripts/extract_housing_society.py
    python3 scripts/extract_housing_society.py --dry-run
    python3 scripts/extract_housing_society.py --limit 200
    python3 scripts/extract_housing_society.py --dry-run --limit 50
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

# ── env / deps ─────────────────────────────────────────────────────────────────
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

# ── CLI ────────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(
    description="Backfill society_name for Housing.com listings from address string"
)
parser.add_argument("--dry-run", action="store_true",
                    help="Print what would be written; no DB changes")
parser.add_argument("--limit", type=int, default=None, metavar="N",
                    help="Process at most N listings")
args = parser.parse_args()

DRY_RUN: bool = args.dry_run
LIMIT:   int | None = args.limit

# ── Skip-rule regexes ──────────────────────────────────────────────────────────

# Rule 2: segment ends with a generic geographic suffix (word-boundary at end)
_RE_SUFFIX = re.compile(
    r"\b(Layout|Road|Street|Main|Nagar|Colony|Extension|Village|"
    r"Agrahara|Gardens?)\s*$",
    re.IGNORECASE,
)

# Rule 3: ordinal or structural area label
#   "Phase 1", "2nd Stage", "Stage 2", "Sector 7", "4th Block",
#   "6 Block", "3rd Phase", "HAL 2nd Stage" …
_RE_ORDINAL = re.compile(
    r"^(?:"
    r"\d+(?:st|nd|rd|th)?[-\s]*(?:Phase|Stage|Block|Sector|Floor)"  # "2nd Phase", "4 Block"
    r"|(?:Phase|Stage|Sector|Block)\s*\d+"                           # "Phase 1", "Sector 7"
    r"|[A-Z]{1,5}\s+\d+(?:st|nd|rd|th)?\s+(?:Phase|Stage|Block)"   # "HAL 2nd Stage"
    r")",
    re.IGNORECASE,
)

# Rule 4: plain generic descriptor — "independent house / building / flat / room / floor"
_RE_GENERIC_BUILDING = re.compile(
    r"^independent\s+(?:house|flat|building|room|floor|property)",
    re.IGNORECASE,
)


# ── Extraction logic ───────────────────────────────────────────────────────────
SkipReason = str  # human-readable label for the summary

def extract_society(address: str, locality: str | None) -> tuple[str | None, SkipReason | None]:
    """
    Returns (society_name, None) on success, or (None, reason) when skipped.
    """
    segment = address.split(",")[0].strip()

    # Rule 1 — too short
    if len(segment) < 4:
        return None, "too_short"

    # Rule 2 — ends with generic geographic suffix
    if _RE_SUFFIX.search(segment):
        return None, "geographic_suffix"

    # Rule 3 — ordinal / structural area label
    if _RE_ORDINAL.match(segment):
        return None, "ordinal_structural"

    # Rule 4 — generic building descriptor
    if _RE_GENERIC_BUILDING.match(segment):
        return None, "generic_building"

    # Rule 5 — first segment is just the locality name itself
    if locality and segment.strip().lower() == locality.strip().lower():
        return None, "matches_locality"

    return segment, None


# ── DB ─────────────────────────────────────────────────────────────────────────
def get_conn():
    url = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL", "")
    if not url:
        print("ERROR: SUPABASE_DB_URL / DATABASE_URL is not set.")
        sys.exit(1)
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return psycopg2.connect(url)


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

    cur.execute(
        "SELECT COUNT(*) FROM listings WHERE source = 'housing' AND society_name IS NULL;"
    )
    total_null: int = cur.fetchone()[0]

    cur.execute(
        "SELECT COUNT(*) FROM listings WHERE source = 'housing';"
    )
    total_housing: int = cur.fetchone()[0]

    limit_clause = f"LIMIT {LIMIT}" if LIMIT is not None else ""
    cur.execute(f"""
        SELECT id, address, locality
        FROM   listings
        WHERE  source       = 'housing'
          AND  society_name IS NULL
          AND  address      IS NOT NULL
        ORDER  BY id
        {limit_clause};
    """)
    rows = cur.fetchall()

    section("HOUSING.COM SOCIETY NAME EXTRACTION")
    print(f"  Total housing rows        : {total_housing:,}")
    print(f"  Rows missing society_name : {total_null:,}")
    print(f"  Rows to process           : {len(rows):,}")
    if DRY_RUN:
        print()
        print("  *** DRY RUN — no writes will be made ***")

    # ── Process ────────────────────────────────────────────────────────────────
    extractions: list[tuple[int, str]] = []   # (id, society_name)
    skip_counts: dict[str, int] = {
        "too_short":          0,
        "geographic_suffix":  0,
        "ordinal_structural": 0,
        "generic_building":   0,
        "matches_locality":   0,
    }

    for listing_id, address, locality in rows:
        society, reason = extract_society(address, locality)
        if society:
            extractions.append((listing_id, society))
            if DRY_RUN:
                seg = address.split(",")[0].strip()
                print(f"  id={listing_id:<8}  {seg!r}")
                print(f"             ← {address[:70]}")
        else:
            skip_counts[reason] = skip_counts.get(reason, 0) + 1

    # ── Write ──────────────────────────────────────────────────────────────────
    written = 0
    if not DRY_RUN and extractions:
        psycopg2.extras.execute_batch(
            cur,
            "UPDATE listings SET society_name = %s WHERE id = %s;",
            [(name, lid) for lid, name in extractions],
            page_size=200,
        )
        conn.commit()
        written = len(extractions)

    # ── Summary ────────────────────────────────────────────────────────────────
    section("Summary")
    print(f"  Rows processed            : {len(rows):,}")
    print(f"  Extracted (society_name)  : {len(extractions):,}")
    if DRY_RUN:
        print(f"  Would have been written   : {len(extractions):,}")
    else:
        print(f"  Written to DB             : {written:,}")
    print()
    total_skipped = sum(skip_counts.values())
    print(f"  Skipped total             : {total_skipped:,}")
    print(f"    geographic suffix        : {skip_counts['geographic_suffix']:,}"
          f"  (ends with Layout/Road/Nagar/…)")
    print(f"    ordinal/structural       : {skip_counts['ordinal_structural']:,}"
          f"  (Phase 1 / Sector 7 / 4th Block…)")
    print(f"    matches locality         : {skip_counts['matches_locality']:,}"
          f"  (first segment = stored locality)")
    print(f"    generic building         : {skip_counts['generic_building']:,}"
          f"  (Independent house/building/…)")
    print(f"    too short (<4 chars)     : {skip_counts['too_short']:,}")
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
