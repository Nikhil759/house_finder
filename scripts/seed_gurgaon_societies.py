#!/usr/bin/env python3
"""
seed_gurgaon_societies.py — Seed the `societies` table with a curated list
of well-known Gurgaon gated communities / apartment complexes.

This is the top-down bootstrap step: it populates the Societies section
before any listing has been scraped, so the section isn't empty on launch.
It intentionally does NOT set latitude/longitude or place_id — coordinates
and photos are filled in afterwards by enrich_societies_from_places.py,
which geocodes each row via Google Places rather than trusting hand-typed
coordinates.

IMPORTANT: this list was compiled from general knowledge of Gurgaon real
estate (DLF/Sushant Lok/Golf Course Road/Sohna Road corridors etc.), not
scraped from a verified source. Sector / locality labels are believed
correct for the well-known projects here, but should be spot-checked
against a live source (99acres/Housing.com project pages, MagicBricks)
before this is treated as authoritative. Treat this as a starting seed to
unblock building the Societies UI, not a finished directory — the
99acres/Housing.com project-page scraper (source='99acres_project' /
'housing_project') is the intended path to scale and verify coverage.

Usage:
    python3 scripts/seed_gurgaon_societies.py
    python3 scripts/seed_gurgaon_societies.py --dry-run
    python3 scripts/seed_gurgaon_societies.py --limit 10
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    print("ERROR: python-dotenv not installed.  Run: pip install python-dotenv")
    sys.exit(1)

env_path = Path(__file__).resolve().parent.parent / "backend" / ".env"
# override=True: a stale value exported into this shell session by an earlier
# `source .env` call should not shadow a value you just edited in the file.
load_dotenv(env_path if env_path.exists() else None, override=True)

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2 not installed.  Run: pip install psycopg2-binary")
    sys.exit(1)

# ── CLI ────────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="Seed Gurgaon societies")
parser.add_argument("--dry-run", action="store_true", help="Print what would be written; no DB changes")
parser.add_argument("--limit", type=int, default=None, metavar="N", help="Seed at most N societies")
args = parser.parse_args()

DRY_RUN: bool = args.dry_run
LIMIT: int | None = args.limit

CITY = "gurgaon"
SOURCE = "manual_seed"

# ── Seed data: (name, locality, developer) ──────────────────────────────────
# `locality` is whichever label (sector number or named corridor) the
# society is most commonly referred to by — matches how these are searched
# for in practice, not a strict administrative sector.
SOCIETIES: list[tuple[str, str, str]] = [
    # ── Golf Course Road corridor ──
    ("DLF The Camellias", "Golf Course Road", "DLF"),
    ("DLF The Aralias", "Sector 42", "DLF"),
    ("DLF The Belaire", "Sector 54", "DLF"),
    ("DLF The Magnolias", "Golf Course Road", "DLF"),
    ("DLF Park Place", "Sector 54", "DLF"),
    ("DLF Pinnacle", "Sector 43", "DLF"),
    ("DLF Beverly Park", "Sector 53", "DLF"),
    ("DLF Princeton Estate", "Sector 53", "DLF"),
    ("Central Park Resorts", "Sector 42", "Central Park"),
    ("Central Park II Room With A View", "Sector 48", "Central Park"),
    ("Ireo Skyon", "Sector 60", "Ireo"),
    ("Ireo Grand Arch", "Sector 58", "Ireo"),
    ("Ireo Victory Valley", "Sector 67", "Ireo"),
    ("M3M Golfestate", "Sector 65", "M3M India"),
    ("M3M Merlin", "Sector 67", "M3M India"),
    ("ATS Kingston Heath", "Sector 53", "ATS Infrastructure"),
    ("Vipul Belmonte", "Sector 53", "Vipul Ltd"),
    ("Vipul Greens", "Sector 48", "Vipul Ltd"),
    ("Emaar Emerald Hills", "Sector 65", "Emaar MGF"),
    ("Pioneer Araya", "Sector 62", "Pioneer Urban"),

    # ── Sohna Road corridor ──
    ("Vatika India Next", "Sector 82", "Vatika Group"),
    ("Vatika Primrose", "Sector 82", "Vatika Group"),
    ("Raheja Atlantis", "Sector 31", "Raheja Developers"),
    ("Orchid Petals", "Sector 49", "Orchid Infrastructure"),
    ("Nirvana Country", "Sector 50", "Unitech"),
    ("Malibu Towne", "Sector 47", "Anant Raj"),
    ("South City II", "Sector 49", "Suncity Projects"),
    ("Ansal Esencia", "Sector 67", "Ansal API"),
    ("Ansal Highland Park", "Sector 103", "Ansal API"),

    # ── DLF Phases / Sushant Lok (older Gurgaon) ──
    ("DLF Phase 1", "Sector 26", "DLF"),
    ("DLF Phase 2", "Sector 25", "DLF"),
    ("DLF Phase 3", "Sector 24", "DLF"),
    ("DLF Phase 4", "Sector 28", "DLF"),
    ("DLF Phase 5", "Sector 43", "DLF"),
    ("DLF Westend Heights", "Sector 53", "DLF"),
    ("Hamilton Court", "Sector 27", "DLF"),
    ("Uniworld Garden 1", "Sector 47", "Unitech"),
    ("Sushant Lok 1", "Sector 43", "Ansal API"),

    # ── NH8 / New Gurgaon ──
    ("Ambience Lagoon", "NH8", "Ambience Group"),
    ("Ambience Caitriona", "NH8", "Ambience Group"),
    ("Unitech Espace", "Sector 50", "Unitech"),
    ("Unitech The Close", "Sector 50", "Unitech"),
    ("Bestech Park View Grand Spa", "Sector 81", "Bestech"),
    ("Bestech Park View Sanskruti", "Sector 92", "Bestech"),
    ("Godrej Summit", "Sector 104", "Godrej Properties"),
    ("Signature Global Park", "Sector 36", "Signature Global"),
    ("Tulip Violet", "Sector 69", "Tulip Infratech"),
    ("Tulip Ivory", "Sector 70", "Tulip Infratech"),
    ("ATS Kocoon", "Sector 109", "ATS Infrastructure"),
    ("Whiteland Blissville", "Sector 76", "Whiteland Corporation"),
    ("Chintels Paradiso", "Sector 109", "Chintels India"),
    ("Pioneer Park", "Sector 62", "Pioneer Urban"),
]


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s


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
    rows = SOCIETIES[:LIMIT] if LIMIT is not None else SOCIETIES

    section("SEED GURGAON SOCIETIES")
    print(f"  City               : {CITY}")
    print(f"  Total in seed list : {len(SOCIETIES):,}")
    print(f"  To process         : {len(rows):,}")
    if DRY_RUN:
        print()
        print("  *** DRY RUN — no writes will be made ***")

    if DRY_RUN:
        print()
        for name, locality, developer in rows:
            print(f"  {name:<36} {locality:<18} {developer}")
        section("Summary")
        print(f"  Would upsert : {len(rows):,}")
        print()
        return

    conn = get_conn()
    cur = conn.cursor()

    inserted = 0
    updated = 0
    for name, locality, developer in rows:
        slug = slugify(name)
        cur.execute(
            """
            INSERT INTO societies (city, name, slug, locality, developer, source)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (city, name) DO UPDATE SET
                slug        = EXCLUDED.slug,
                locality    = EXCLUDED.locality,
                developer   = EXCLUDED.developer,
                updated_at  = NOW()
            RETURNING (xmax = 0) AS inserted;
            """,
            (CITY, name, slug, locality, developer, SOURCE),
        )
        (was_insert,) = cur.fetchone()
        if was_insert:
            inserted += 1
        else:
            updated += 1

    conn.commit()
    cur.close()
    conn.close()

    section("Summary")
    print(f"  Inserted (new) : {inserted:,}")
    print(f"  Updated        : {updated:,}")
    print(f"  Total upserted : {inserted + updated:,}")
    print()
    print("  Next step: python3 scripts/enrich_societies_from_places.py")
    print()


if __name__ == "__main__":
    main()
