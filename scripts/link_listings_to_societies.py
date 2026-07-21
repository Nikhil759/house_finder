#!/usr/bin/env python3
"""
link_listings_to_societies.py — Backfill listings.society_id by matching
listings.society_name against the societies directory.

This is what makes "browse listings inside this society" on the society
detail page possible. It's a separate step from ingestion because most
sources only ever produce a free-text society_name (regex-extracted from
Housing.com addresses, parsed from NoBroker's raw payload, or Gemini-
extracted from Reddit/Telegram) — none of them currently emit a society_id
directly.

Matching strategy (in order, first match wins):
  1. Exact match: lower(listings.society_name) == lower(societies.name)
  2. Token-overlap fuzzy match: >= 0.6 word-overlap ratio against any
     society in the same city (reuses the same tokenize/overlap approach
     as enrich_society_images.py / enrich_societies_from_places.py)

Only listings with a NULL society_id are considered, so this is safe to
re-run after every ingestion cycle without redoing work.

Usage:
    python3 scripts/link_listings_to_societies.py
    python3 scripts/link_listings_to_societies.py --city gurgaon
    python3 scripts/link_listings_to_societies.py --dry-run
    python3 scripts/link_listings_to_societies.py --dry-run --limit 200
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
parser = argparse.ArgumentParser(description="Link listings.society_name to societies.id")
parser.add_argument("--dry-run", action="store_true", help="Print matches; no DB writes")
parser.add_argument("--city", default="gurgaon", metavar="CITY", help="City to link within (default: gurgaon)")
parser.add_argument("--limit", type=int, default=None, metavar="N", help="Process at most N listings")
parser.add_argument(
    "--min-overlap", type=float, default=0.6, metavar="RATIO",
    help="Minimum token-overlap ratio for a fuzzy match (default 0.6)",
)
args = parser.parse_args()

DRY_RUN: bool = args.dry_run
CITY: str = args.city
LIMIT: int | None = args.limit
MIN_OVERLAP: float = args.min_overlap


def tokenize(name: str) -> set[str]:
    return {w for w in re.split(r"\W+", name.lower()) if len(w) >= 3}


def overlap_ratio(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / max(len(a), len(b))


def get_conn():
    url = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL", "")
    if not url:
        print("ERROR: SUPABASE_DB_URL / DATABASE_URL is not set.")
        sys.exit(1)
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return psycopg2.connect(url)


WIDTH = 60


def section(title: str) -> None:
    print()
    print("─" * WIDTH)
    print(f"  {title}")
    print("─" * WIDTH)


def main() -> None:
    conn = get_conn()
    cur = conn.cursor()

    # Load the society directory for this city once.
    cur.execute("SELECT id, name FROM societies WHERE city = %s AND is_active = TRUE;", (CITY,))
    society_rows = cur.fetchall()
    if not society_rows:
        print(f"ERROR: no societies found for city={CITY!r}. Run seed_gurgaon_societies.py first.")
        sys.exit(1)

    exact_index: dict[str, int] = {name.strip().lower(): sid for sid, name in society_rows}
    token_index: list[tuple[int, str, set[str]]] = [(sid, name, tokenize(name)) for sid, name in society_rows]

    # Unlinked listings with a society_name to match against.
    limit_clause = f"LIMIT {LIMIT}" if LIMIT is not None else ""
    cur.execute(f"""
        SELECT id, society_name
        FROM   listings
        WHERE  society_id   IS NULL
          AND  society_name IS NOT NULL
          AND  society_name != ''
        ORDER  BY id
        {limit_clause};
    """)
    rows = cur.fetchall()

    section("LINK LISTINGS TO SOCIETIES")
    print(f"  City                        : {CITY}")
    print(f"  Societies in directory       : {len(society_rows):,}")
    print(f"  Unlinked listings w/ society : {len(rows):,}")
    print(f"  Min fuzzy overlap ratio      : {MIN_OVERLAP}")
    if DRY_RUN:
        print()
        print("  *** DRY RUN — no writes will be made ***")

    matches: list[tuple[int, int]] = []  # (listing_id, society_id)
    stats = {"exact": 0, "fuzzy": 0, "unmatched": 0}

    for listing_id, society_name in rows:
        key = society_name.strip().lower()

        if key in exact_index:
            sid = exact_index[key]
            matches.append((listing_id, sid))
            stats["exact"] += 1
            if DRY_RUN:
                print(f"  [exact] id={listing_id:<8} {society_name!r}")
            continue

        listing_tokens = tokenize(society_name)
        best_sid, best_ratio, best_name = None, 0.0, None
        for sid, name, name_tokens in token_index:
            ratio = overlap_ratio(listing_tokens, name_tokens)
            if ratio > best_ratio:
                best_sid, best_ratio, best_name = sid, ratio, name

        if best_sid is not None and best_ratio >= MIN_OVERLAP:
            matches.append((listing_id, best_sid))
            stats["fuzzy"] += 1
            if DRY_RUN:
                print(f"  [fuzzy] id={listing_id:<8} {society_name!r} → {best_name!r} ({best_ratio:.2f})")
        else:
            stats["unmatched"] += 1

    if not DRY_RUN and matches:
        psycopg2.extras.execute_batch(
            cur,
            "UPDATE listings SET society_id = %s WHERE id = %s;",
            [(sid, lid) for lid, sid in matches],
            page_size=200,
        )
        conn.commit()

        # Refresh the cached listing_count on societies (best-effort — not
        # authoritative, always recomputable from listings directly).
        cur.execute("""
            UPDATE societies s
            SET listing_count = sub.cnt, updated_at = NOW()
            FROM (
                SELECT society_id, COUNT(*) AS cnt
                FROM listings
                WHERE society_id IS NOT NULL AND status = 'active'
                GROUP BY society_id
            ) sub
            WHERE s.id = sub.society_id;
        """)
        conn.commit()

    cur.close()
    conn.close()

    section("Summary")
    print(f"  Exact matches     : {stats['exact']:,}")
    print(f"  Fuzzy matches     : {stats['fuzzy']:,}")
    print(f"  Unmatched         : {stats['unmatched']:,}")
    if DRY_RUN:
        print(f"  Would link        : {len(matches):,}")
    else:
        print(f"  Linked            : {len(matches):,}")
        print(f"  listing_count refreshed on societies table")
    print()


if __name__ == "__main__":
    main()
