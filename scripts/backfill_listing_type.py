#!/usr/bin/env python3
"""
backfill_listing_type.py — Reclassify listing_type for all historical
Reddit and Telegram rows using the Phase 2a Gemini classifier.

Rows from other sources (nobroker, housing, 99acres) are NOT touched.

Usage:
    python3 scripts/backfill_listing_type.py --dry-run
    python3 scripts/backfill_listing_type.py
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    print("ERROR: python-dotenv not installed. Run: pip install python-dotenv")
    sys.exit(1)

env_path = Path(__file__).resolve().parent.parent / "backend" / ".env"
load_dotenv(env_path if env_path.exists() else None)

backend_dir = str(Path(__file__).resolve().parent.parent / "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import psycopg2
from ingestion.classify_listing_type import classify_listing_types
from ingestion.models import StandardListing

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

BATCH_SIZE = 40
SLEEP_BETWEEN_BATCHES = 1.0


def get_connection():
    import os
    url = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("SUPABASE_DB_URL or DATABASE_URL must be set")
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return psycopg2.connect(url)


def fetch_rows(conn) -> list[dict]:
    cur = conn.cursor()
    cur.execute("""
        SELECT id, source, source_id, title, body, bhk, rent, locality,
               listing_type, status
        FROM listings
        WHERE source IN ('reddit', 'telegram')
        ORDER BY id
    """)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def run_backfill(dry_run: bool):
    conn = get_connection()
    rows = fetch_rows(conn)
    total = len(rows)
    logger.info("Found %d Reddit + Telegram rows to process", total)

    dist = {"full_house": 0, "pg": 0, "flatmate": 0, "not_a_listing": 0}
    changes = []
    skipped_ids = []
    processed = 0

    for batch_start in range(0, total, BATCH_SIZE):
        batch = rows[batch_start:batch_start + BATCH_SIZE]

        listings = []
        for row in batch:
            l = StandardListing(
                source=row["source"],
                source_id=row["source_id"],
                title=row["title"],
                body=(row["body"] or "")[:2000],
                bhk=row["bhk"],
                rent=row["rent"],
                locality=row["locality"],
            )
            listings.append(l)

        try:
            classify_listing_types(listings)
        except Exception as e:
            logger.error("Classification failed for batch starting at row %d: %s", batch[0]["id"], e)
            for row in batch:
                skipped_ids.append(row["id"])
            processed += len(batch)
            continue

        if not dry_run:
            update_cur = conn.cursor()

        for row, listing in zip(batch, listings):
            new_type = listing.listing_type
            old_type = row["listing_type"]
            old_status = row["status"]
            dist[new_type] += 1

            type_changed = new_type != old_type
            needs_discard = new_type == "not_a_listing" and old_status != "discarded"
            needs_undiscard = new_type != "not_a_listing" and old_status == "discarded"

            if type_changed or needs_discard or needs_undiscard:
                changes.append({
                    "id": row["id"],
                    "source": row["source"],
                    "old_type": old_type,
                    "new_type": new_type,
                    "old_status": old_status,
                    "title": (row["title"] or row["body"] or "")[:120],
                })

                if not dry_run:
                    new_status = "discarded" if new_type == "not_a_listing" else old_status
                    if old_status == "discarded" and new_type != "not_a_listing":
                        new_status = "active"
                    try:
                        update_cur.execute("""
                            UPDATE listings
                            SET listing_type = %s, status = %s
                            WHERE id = %s
                        """, (new_type, new_status, row["id"]))
                    except Exception as e:
                        logger.error("Failed to update row %d: %s", row["id"], e)
                        skipped_ids.append(row["id"])
                        conn.rollback()
                        update_cur = conn.cursor()

        if not dry_run:
            conn.commit()

        processed += len(batch)
        if processed % 100 < BATCH_SIZE or processed == total:
            logger.info(
                "Processed %d / %d, classified so far: "
                "full_house=%d, pg=%d, flatmate=%d, not_a_listing=%d",
                processed, total,
                dist["full_house"], dist["pg"], dist["flatmate"], dist["not_a_listing"],
            )

        if batch_start + BATCH_SIZE < total:
            time.sleep(SLEEP_BETWEEN_BATCHES)

    conn.close()

    prefix = "[DRY RUN] " if dry_run else ""
    print()
    print(f"{prefix}{'=' * 60}")
    print(f"{prefix}Backfill complete")
    print(f"{prefix}Total rows: {total}")
    print(f"{prefix}Distribution:")
    for label in ("full_house", "pg", "flatmate", "not_a_listing"):
        pct = (dist[label] / total * 100) if total else 0
        print(f"{prefix}  {label}: {dist[label]} ({pct:.1f}%)")
    print(f"{prefix}Rows that would change: {len(changes)}")
    print(f"{prefix}Skipped (errors): {len(skipped_ids)}")
    if skipped_ids:
        print(f"{prefix}Skipped row IDs: {skipped_ids}")
    print(f"{prefix}{'=' * 60}")

    return dist, changes, skipped_ids


def main():
    parser = argparse.ArgumentParser(description="Backfill listing_type for Reddit/Telegram rows")
    parser.add_argument("--dry-run", action="store_true", help="Print what would change without writing to DB")
    args = parser.parse_args()

    if args.dry_run:
        logger.info("DRY RUN mode — no DB writes")

    start = time.time()
    dist, changes, skipped = run_backfill(dry_run=args.dry_run)
    elapsed = time.time() - start

    print(f"\nRuntime: {elapsed:.1f}s")

    if args.dry_run and changes:
        stay_full_house = [c for c in changes if c["old_type"] == "full_house" and c["new_type"] == "full_house"]
        became_flatmate = [c for c in changes if c["new_type"] == "flatmate" and c["old_type"] != "flatmate"]
        became_not_listing = [c for c in changes if c["new_type"] == "not_a_listing"]

        def print_sample(label, items, n=10):
            print(f"\n--- Sample: {label} (showing {min(n, len(items))} of {len(items)}) ---")
            for c in items[:n]:
                print(f"  id={c['id']:<6} src={c['source']:<10} "
                      f"{c['old_type']:<16} → {c['new_type']:<16} {c['title'][:120]}")

        stay_full_house_all = [
            {"id": r["id"], "source": r["source"], "old_type": "full_house",
             "new_type": "full_house", "title": (r["title"] or r["body"] or "")[:120]}
            for r in []
        ]
        print_sample("full_house → flatmate", became_flatmate)
        print_sample("→ not_a_listing", became_not_listing)

        unchanged_fh = [
            r for r in fetch_unchanged_full_house(dist, changes)
        ]
        print_sample("full_house stays full_house (no change)", unchanged_fh)


def fetch_unchanged_full_house(dist, changes):
    changed_ids = {c["id"] for c in changes}
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, source, title, body FROM listings
        WHERE source IN ('reddit', 'telegram')
          AND listing_type = 'full_house'
        ORDER BY id
        LIMIT 200
    """)
    results = []
    for row_id, source, title, body in cur.fetchall():
        if row_id not in changed_ids:
            results.append({
                "id": row_id,
                "source": source,
                "old_type": "full_house",
                "new_type": "full_house",
                "title": (title or body or "")[:120],
            })
        if len(results) >= 10:
            break
    conn.close()
    return results


if __name__ == "__main__":
    main()
