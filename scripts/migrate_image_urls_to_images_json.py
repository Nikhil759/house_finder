#!/usr/bin/env python3
"""
migrate_image_urls_to_images_json.py — Migrate NoBroker image_urls (text[])
into the new images (jsonb) column on the listings table.

Schema prerequisite (run once in Supabase SQL editor before this script):

    ALTER TABLE listings
    ADD COLUMN IF NOT EXISTS images jsonb;

Each image_url is converted to:
    {
        "url":        "<url>",
        "source":     "nobroker",
        "image_type": "listing_interior",
        "attribution": "NoBroker"
    }

The images column is set to a JSON array of these objects.
image_urls is left untouched.

Usage:
    python3 scripts/migrate_image_urls_to_images_json.py
    python3 scripts/migrate_image_urls_to_images_json.py --dry-run
    python3 scripts/migrate_image_urls_to_images_json.py --limit 500
    python3 scripts/migrate_image_urls_to_images_json.py --dry-run --limit 100
"""

from __future__ import annotations

import argparse
import json
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
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2 not installed.  Run: pip install psycopg2-binary")
    sys.exit(1)

# ── CLI ────────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(
    description="Migrate NoBroker image_urls[] → images jsonb column"
)
parser.add_argument(
    "--dry-run", action="store_true",
    help="Compute and print results without writing to DB",
)
parser.add_argument(
    "--limit", type=int, default=None, metavar="N",
    help="Process at most N listings",
)
args = parser.parse_args()

DRY_RUN: bool = args.dry_run
LIMIT:   int | None = args.limit

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


def build_images_json(image_urls: list[str]) -> list[dict]:
    return [
        {
            "url":         url,
            "source":      "nobroker",
            "image_type":  "listing_interior",
            "attribution": "NoBroker",
        }
        for url in image_urls
        if url and url.strip()
    ]


# ── main ───────────────────────────────────────────────────────────────────────
def main() -> None:
    conn = get_conn()
    cur = conn.cursor()

    # Totals for context
    cur.execute("SELECT COUNT(*) FROM listings WHERE source = 'nobroker';")
    total_nobroker: int = cur.fetchone()[0]

    cur.execute("""
        SELECT COUNT(*) FROM listings
        WHERE source = 'nobroker'
          AND image_urls IS NOT NULL
          AND array_length(image_urls, 1) > 0;
    """)
    total_with_images: int = cur.fetchone()[0]

    cur.execute("""
        SELECT COUNT(*) FROM listings
        WHERE source = 'nobroker'
          AND image_urls IS NOT NULL
          AND array_length(image_urls, 1) > 0
          AND images IS NULL;
    """)
    total_pending: int = cur.fetchone()[0]

    limit_clause = f"LIMIT {LIMIT}" if LIMIT is not None else ""
    cur.execute(f"""
        SELECT id, image_urls
        FROM   listings
        WHERE  source      = 'nobroker'
          AND  image_urls  IS NOT NULL
          AND  array_length(image_urls, 1) > 0
          AND  images      IS NULL
        ORDER  BY id
        {limit_clause};
    """)
    rows = cur.fetchall()

    section("IMAGE URL → IMAGES JSONB MIGRATION")
    print(f"  Total NoBroker listings     : {total_nobroker:,}")
    print(f"  With image_urls             : {total_with_images:,}")
    print(f"  Pending migration           : {total_pending:,}")
    print(f"  Rows to process             : {len(rows):,}")
    if DRY_RUN:
        print()
        print("  *** DRY RUN — no writes will be made ***")

    # ── Build updates ──────────────────────────────────────────────────────────
    updates: list[tuple[str, int]] = []  # (images_json_str, id)
    skipped_empty = 0

    for listing_id, image_urls in rows:
        if not image_urls:
            skipped_empty += 1
            continue

        images = build_images_json(image_urls)
        if not images:
            skipped_empty += 1
            continue

        updates.append((json.dumps(images), listing_id))

    if DRY_RUN and updates:
        # Show a sample of what would be written
        sample = updates[:3]
        print()
        print(f"  Sample (first {len(sample)} of {len(updates)}):")
        for images_json, listing_id in sample:
            parsed = json.loads(images_json)
            print(f"    id={listing_id}  →  {len(parsed)} image(s)")
            print(f"      first url: {parsed[0]['url'][:70]}")

    # ── Write ──────────────────────────────────────────────────────────────────
    written = 0
    if not DRY_RUN and updates:
        psycopg2.extras.execute_batch(
            cur,
            "UPDATE listings SET images = %s::jsonb WHERE id = %s;",
            updates,
            page_size=200,
        )
        conn.commit()
        written = len(updates)

    # ── Summary ────────────────────────────────────────────────────────────────
    section("Summary")
    print(f"  Rows processed              : {len(rows):,}")
    print(f"  Skipped (empty urls)        : {skipped_empty:,}")
    if DRY_RUN:
        print(f"  Would be written            : {len(updates):,}")
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
