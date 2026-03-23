#!/usr/bin/env python3
"""
Cross-source deduplication for NestIQ listings.

Detects when the same flat appears on multiple sources (e.g. NoBroker + Housing.com)
and groups them under a shared duplicate_group_id. The listing with the highest
quality_score in each group is the canonical one shown in search results.

Matching strategy (strict single-pass, high confidence only):
  same locality (case-insensitive) + same BHK + rent within 5%
  + area_sqft present on BOTH sides and within 30 sqft

  area_sqft is REQUIRED — without it we can't be confident enough.
  No soft/fuzzy matching to avoid Union-Find chaining false positives.
  Only cross-source pairs are compared (same-source dupes handled by UNIQUE constraint).

Only scans listings from the last 48 hours so large re-scans are avoided.
Safe to run multiple times — fully idempotent.

Usage:
    python -m ingestion.run_dedup
"""

from __future__ import annotations

import logging
import os
import sys
from itertools import combinations

import psycopg2
import psycopg2.extras

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("run_dedup")


# ── Config ────────────────────────────────────────────────────────────────────

RENT_TOLERANCE = 0.05        # 5% rent difference max
AREA_TOLERANCE_SQFT = 30     # ±30 sqft max; area MUST be present on both sides
LOOKBACK_HOURS = 48          # only process listings seen in last 48h


# ── DB helpers ────────────────────────────────────────────────────────────────

def _get_connection():
    url = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("SUPABASE_DB_URL or DATABASE_URL must be set")
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return psycopg2.connect(url, connect_timeout=15)


# ── Matching helpers ──────────────────────────────────────────────────────────

def _is_match(a: dict, b: dict) -> bool:
    """
    High-confidence duplicate check. ALL four conditions must hold:
      1. Same locality (exact, case-insensitive)
      2. Same BHK (normalised)
      3. Rent within RENT_TOLERANCE (5%)
      4. area_sqft present on BOTH sides and within AREA_TOLERANCE_SQFT (30 sqft)
    """
    # locality
    if not a["locality"] or not b["locality"]:
        return False
    if a["locality"].strip().lower() != b["locality"].strip().lower():
        return False

    # bhk
    if not a["bhk"] or not b["bhk"]:
        return False
    if a["bhk"].strip().lower().replace(" ", "") != b["bhk"].strip().lower().replace(" ", ""):
        return False

    # rent (both must be present)
    r1, r2 = a["rent"], b["rent"]
    if r1 is None or r2 is None:
        return False
    hi = max(r1, r2)
    if (hi - min(r1, r2)) / hi > RENT_TOLERANCE:
        return False

    # area (REQUIRED — no area = no match)
    a1, a2 = a["area_sqft"], b["area_sqft"]
    if a1 is None or a2 is None:
        return False
    if abs(a1 - a2) > AREA_TOLERANCE_SQFT:
        return False

    return True


# ── Main dedup logic ──────────────────────────────────────────────────────────

def run_dedup() -> dict:
    """
    Fetch recent active listings, find duplicates across sources,
    update duplicate_group_id in the DB.

    Returns stats dict.
    """
    conn = _get_connection()
    stats = {"fetched": 0, "groups_found": 0, "listings_grouped": 0, "errors": 0}

    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Only fetch listings seen in last LOOKBACK_HOURS that have the fields we need
        cur.execute("""
            SELECT id, source, source_id, source_url,
                   locality, bhk, rent, area_sqft, address, quality_score,
                   duplicate_group_id
            FROM listings
            WHERE status = 'active'
              AND last_seen_at > NOW() - INTERVAL '%s hours'
              AND locality IS NOT NULL
              AND bhk IS NOT NULL
              AND rent IS NOT NULL
            ORDER BY quality_score DESC
        """, (LOOKBACK_HOURS,))

        rows = cur.fetchall()
        stats["fetched"] = len(rows)
        logger.info("Fetched %d eligible listings for dedup", len(rows))

        if len(rows) < 2:
            logger.info("Not enough listings to dedup")
            return stats

        # Group by (locality_lower, bhk_normalised) to limit comparison pairs
        from collections import defaultdict
        buckets: dict[tuple, list[dict]] = defaultdict(list)
        for row in rows:
            key = (
                (row["locality"] or "").strip().lower(),
                (row["bhk"] or "").strip().lower().replace(" ", ""),
            )
            buckets[key].append(dict(row))

        # Strict pairwise grouping — no Union-Find chaining.
        # Each listing can belong to at most one group.
        # If a listing already has a group assignment, skip it to avoid
        # pulling unrelated listings into the same group via a shared intermediary.
        assigned: dict[int, int] = {}   # listing_id → group_id (= canonical listing_id)
        groups: dict[int, list[int]] = {}  # group_id → [listing_ids]

        for key, group in buckets.items():
            if len(group) < 2:
                continue
            for a, b in combinations(group, 2):
                # Cross-source only
                if a["source"] == b["source"]:
                    continue
                # Skip if either already assigned (prevents chaining)
                if a["id"] in assigned or b["id"] in assigned:
                    continue
                if not _is_match(a, b):
                    continue
                # Use the higher-quality listing's id as group_id
                canonical = a if a["quality_score"] >= b["quality_score"] else b
                other = b if canonical is a else a
                gid = canonical["id"]
                assigned[canonical["id"]] = gid
                assigned[other["id"]] = gid
                groups[gid] = [canonical["id"], other["id"]]
        stats["groups_found"] = len(groups)

        if not groups:
            logger.info("No duplicates found")
            return stats

        # Persist: use the root id of each group as the duplicate_group_id
        update_cur = conn.cursor()
        for root, members in groups.items():
            group_id = root  # use the listing id of the canonical (highest score, fetched first)
            for listing_id in members:
                try:
                    update_cur.execute(
                        "UPDATE listings SET duplicate_group_id = %s WHERE id = %s",
                        (group_id, listing_id),
                    )
                    stats["listings_grouped"] += 1
                except Exception as e:
                    logger.error("Failed to update duplicate_group_id for listing %s: %s", listing_id, e)
                    stats["errors"] += 1

        # Also clear stale duplicate_group_id for listings that are no longer in any group
        # (e.g. one side got marked stale/expired since last run)
        grouped_ids = {lid for members in groups.values() for lid in members}
        cur.execute("""
            SELECT id FROM listings
            WHERE duplicate_group_id IS NOT NULL
              AND status = 'active'
              AND last_seen_at > NOW() - INTERVAL '%s hours'
        """, (LOOKBACK_HOURS,))
        previously_grouped = {row["id"] for row in cur.fetchall()}
        stale_groups = previously_grouped - grouped_ids
        if stale_groups:
            update_cur.execute(
                "UPDATE listings SET duplicate_group_id = NULL WHERE id = ANY(%s)",
                (list(stale_groups),),
            )
            logger.info("Cleared stale duplicate_group_id from %d listings", len(stale_groups))

        conn.commit()
        logger.info(
            "Dedup complete: %d groups, %d listings grouped, %d errors",
            stats["groups_found"], stats["listings_grouped"], stats["errors"],
        )

    except Exception as e:
        logger.error("run_dedup failed: %s", e)
        conn.rollback()
        stats["errors"] += 1
    finally:
        conn.close()

    return stats


if __name__ == "__main__":
    result = run_dedup()
    sys.exit(0 if result["errors"] == 0 else 1)
