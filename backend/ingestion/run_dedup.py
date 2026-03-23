#!/usr/bin/env python3
"""
Cross-source deduplication for NestIQ listings.

Detects when the same flat appears on multiple sources (e.g. NoBroker + Housing.com)
and groups them under a shared duplicate_group_id. The listing with the highest
quality_score in each group is the canonical one shown in search results.

Matching strategy (two-pass):
  Pass 1 — Hard match (high confidence):
    same locality (case-insensitive) + same BHK + rent within 10% + area within 50 sqft
  Pass 2 — Soft match (medium confidence):
    same locality + same BHK + rent within 15% + address similarity >= 70%

Only scans listings from the last 48 hours so large re-scans are avoided.
Safe to run multiple times — fully idempotent.

Usage:
    python -m ingestion.run_dedup
"""

from __future__ import annotations

import logging
import os
import sys
from difflib import SequenceMatcher
from itertools import combinations

import psycopg2
import psycopg2.extras

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("run_dedup")


# ── Config ────────────────────────────────────────────────────────────────────

RENT_TOLERANCE_HARD = 0.10   # 10% rent difference → hard match
RENT_TOLERANCE_SOFT = 0.15   # 15% rent difference → soft match
AREA_TOLERANCE_SQFT = 50     # ±50 sqft → hard match
ADDRESS_SIM_THRESHOLD = 0.70  # 70% fuzzy similarity → soft match
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

def _rents_close(r1, r2, tolerance: float) -> bool:
    if r1 is None or r2 is None:
        return False
    lo, hi = min(r1, r2), max(r1, r2)
    return (hi - lo) / hi <= tolerance


def _areas_close(a1, a2) -> bool:
    if a1 is None or a2 is None:
        return False
    return abs(a1 - a2) <= AREA_TOLERANCE_SQFT


def _address_similarity(a1: str, a2: str) -> float:
    if not a1 or not a2:
        return 0.0
    return SequenceMatcher(None, a1.lower().strip(), a2.lower().strip()).ratio()


def _bhk_matches(b1, b2) -> bool:
    """Case-insensitive BHK comparison, normalising spaces."""
    if b1 is None or b2 is None:
        return False
    return b1.strip().lower().replace(" ", "") == b2.strip().lower().replace(" ", "")


def _locality_matches(l1, l2) -> bool:
    if l1 is None or l2 is None:
        return False
    return l1.strip().lower() == l2.strip().lower()


def _is_hard_match(a: dict, b: dict) -> bool:
    return (
        _locality_matches(a["locality"], b["locality"])
        and _bhk_matches(a["bhk"], b["bhk"])
        and _rents_close(a["rent"], b["rent"], RENT_TOLERANCE_HARD)
        and _areas_close(a["area_sqft"], b["area_sqft"])
    )


def _is_soft_match(a: dict, b: dict) -> bool:
    return (
        _locality_matches(a["locality"], b["locality"])
        and _bhk_matches(a["bhk"], b["bhk"])
        and _rents_close(a["rent"], b["rent"], RENT_TOLERANCE_SOFT)
        and _address_similarity(a["address"], b["address"]) >= ADDRESS_SIM_THRESHOLD
    )


# ── Union-Find (for grouping clusters of duplicates) ─────────────────────────

class UnionFind:
    def __init__(self):
        self._parent: dict[int, int] = {}

    def find(self, x: int) -> int:
        self._parent.setdefault(x, x)
        if self._parent[x] != x:
            self._parent[x] = self.find(self._parent[x])
        return self._parent[x]

    def union(self, x: int, y: int):
        self._parent[self.find(x)] = self.find(y)

    def groups(self) -> dict[int, list[int]]:
        """Returns {root_id: [member_ids]} for groups with >1 member."""
        result: dict[int, list[int]] = {}
        for x in self._parent:
            root = self.find(x)
            result.setdefault(root, [])
            if x not in result[root]:
                result[root].append(x)
        return {k: v for k, v in result.items() if len(v) > 1}


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

        uf = UnionFind()

        for key, group in buckets.items():
            if len(group) < 2:
                continue
            # Only compare across different sources — no point deduping within same source
            for a, b in combinations(group, 2):
                if a["source"] == b["source"]:
                    continue
                if _is_hard_match(a, b) or _is_soft_match(a, b):
                    uf.union(a["id"], b["id"])

        groups = uf.groups()
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
