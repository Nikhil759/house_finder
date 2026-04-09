#!/usr/bin/env python3
"""
normalize_localities.py — Normalize locality spelling variants in the listings table
to a canonical set.

Usage:
    python3 scripts/normalize_localities.py
    python3 scripts/normalize_localities.py --dry-run
"""

from __future__ import annotations

import argparse
import os
import sys
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
except ImportError:
    print("ERROR: psycopg2 not installed.  Run: pip install psycopg2-binary")
    sys.exit(1)

# ── CLI ────────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(
    description="Normalize locality spelling variants to canonical values"
)
parser.add_argument(
    "--dry-run", action="store_true",
    help="Show what would be updated without writing to DB",
)
args = parser.parse_args()

DRY_RUN: bool = args.dry_run

# ── Remapping table ────────────────────────────────────────────────────────────
# Each entry: (canonical, [variants to remap])
REMAPPINGS: list[tuple[str, list[str]]] = [
    ("JP Nagar",        ["J. P. Nagar", "J.P Nagar"]),
    ("Banaswadi",       ["Banasawadi", "Banswadi"]),
    ("Koramangala",     ["KORMANGALA"]),
    ("Yeshwanthpur",    ["Yeswanthpur"]),
    ("Bommanahalli",    ["Bommanhalli"]),
    ("KR Puram",        ["K R Puram"]),
    ("Yelahanka",       ["Yelhanka"]),
    ("Doddakannelli",   ["Doddakannelli,"]),
    ("Gottigere",       ["Gottigere, Bengaluru"]),
]

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

    section("LOCALITY NORMALIZATION")
    if DRY_RUN:
        print()
        print("  *** DRY RUN — no writes will be made ***")

    total_updated = 0

    print()
    for canonical, variants in REMAPPINGS:
        for variant in variants:
            # Count matching rows first
            cur.execute(
                "SELECT COUNT(*) FROM listings WHERE locality = %s;",
                (variant,),
            )
            count: int = cur.fetchone()[0]

            if count == 0:
                print(f"  {variant!r:35s} → {canonical!r:20s}  (0 rows — skipped)")
                continue

            if DRY_RUN:
                print(f"  {variant!r:35s} → {canonical!r:20s}  would update {count} row(s)")
            else:
                cur.execute(
                    "UPDATE listings SET locality = %s WHERE locality = %s;",
                    (canonical, variant),
                )
                conn.commit()
                print(f"  {variant!r:35s} → {canonical!r:20s}  updated {count} row(s)")

            total_updated += count

    section("Summary")
    if DRY_RUN:
        print(f"  Would update                : {total_updated:,} row(s)")
        print()
        print("  *** DRY RUN — nothing written ***")
    else:
        print(f"  Total rows updated          : {total_updated:,}")
    print()
    print("─" * WIDTH)
    print("  Done.")
    print()

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
