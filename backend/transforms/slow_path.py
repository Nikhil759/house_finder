"""
Slow-path transforms — scheduled daily at 2:30–3:00 AM UTC via Railway Cron.

Jobs:
  1. Rent anomaly flagging (is_per_room, price_anomaly, rent_type)
  2. Quality rescoring (4-dimension composite)
  3. Cross-source deduplication
"""

from __future__ import annotations

import logging
import math
import os
import sys
from datetime import datetime, timezone
from itertools import combinations
from collections import defaultdict

import psycopg2
import psycopg2.extras

from transforms.db import (
    get_connection,
    record_transform_start,
    record_transform_end,
)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# 1. Rent Anomaly Flagging
# ─────────────────────────────────────────────

PER_ROOM_KEYWORDS = [
    "per room", "per person", "single room", "single occupancy",
    "sharing", "per head", "1 room", "one room rent",
    "room rent", "per bed",
]

def run_rent_anomaly_flagging():
    """
    Detect rent anomalies and per-room pricing.
    Updates listings_curated with price_anomaly, is_per_room, rent_type.
    """
    started_at = datetime.now(timezone.utc)
    run_id = record_transform_start("rent_anomaly")
    processed = 0
    flagged_anomaly = 0
    flagged_per_room = 0

    try:
        conn = get_connection()
        cur = conn.cursor()

        cur.execute("""
            SELECT locality, bhk,
                   AVG(rent) AS avg_rent,
                   STDDEV(rent) AS stddev_rent
            FROM listings
            WHERE status IN ('active', 'stale')
              AND rent IS NOT NULL AND rent > 3000
              AND locality IS NOT NULL AND bhk IS NOT NULL
              AND listing_type = 'full_house'
            GROUP BY locality, bhk
            HAVING COUNT(*) >= 5
        """)
        stats = {}
        for locality, bhk, avg_rent, stddev_rent in cur.fetchall():
            stats[(locality, bhk)] = (float(avg_rent), float(stddev_rent or 0))

        cur.execute("""
            SELECT l.id, l.source, l.rent, l.bhk, l.locality,
                   l.title, l.body
            FROM listings l
            WHERE l.status IN ('active', 'stale')
              AND l.rent IS NOT NULL
              AND l.listing_type = 'full_house'
        """)
        rows = cur.fetchall()
        processed = len(rows)

        update_cur = conn.cursor()
        for listing_id, source, rent, bhk, locality, title, body in rows:
            text = f"{title or ''} {body or ''}".lower()

            is_per_room = any(kw in text for kw in PER_ROOM_KEYWORDS)
            if source in ("reddit", "telegram") and bhk and rent:
                bhk_num = _extract_bhk_number(bhk)
                if bhk_num and bhk_num >= 2:
                    key = (locality, bhk)
                    if key in stats:
                        avg, _ = stats[key]
                        if avg > 0 and rent < avg * 0.4:
                            is_per_room = True

            price_anomaly = False
            if rent and locality and bhk:
                key = (locality, bhk)
                if key in stats:
                    avg, stddev = stats[key]
                    if stddev > 0 and abs(rent - avg) > 2 * stddev:
                        price_anomaly = True

            if rent and rent < 2000:
                price_anomaly = True

            rent_type = "unknown"
            if is_per_room:
                rent_type = "per_room"
                flagged_per_room += 1
            elif rent and not price_anomaly:
                rent_type = "whole"

            if price_anomaly:
                flagged_anomaly += 1

            update_cur.execute("""
                INSERT INTO listings_curated (listing_id, price_anomaly, is_per_room, rent_type, updated_at)
                VALUES (%s, %s, %s, %s, NOW())
                ON CONFLICT (listing_id) DO UPDATE SET
                    price_anomaly = EXCLUDED.price_anomaly,
                    is_per_room   = EXCLUDED.is_per_room,
                    rent_type     = EXCLUDED.rent_type,
                    updated_at    = NOW()
            """, (listing_id, price_anomaly, is_per_room, rent_type))

        conn.commit()
        conn.close()

        record_transform_end(
            run_id, status="success",
            records_processed=processed,
            started_at=started_at,
            metadata={
                "flagged_anomaly": flagged_anomaly,
                "flagged_per_room": flagged_per_room,
            },
        )
        logger.info(
            "Rent anomaly: %d processed, %d anomalies, %d per-room",
            processed, flagged_anomaly, flagged_per_room,
        )
    except Exception as e:
        logger.error("Rent anomaly flagging failed: %s", e)
        record_transform_end(run_id, status="failed", error_message=str(e), started_at=started_at)
        raise


def _extract_bhk_number(bhk: str) -> int | None:
    """Extract the numeric part from '2 BHK' → 2."""
    import re
    m = re.match(r"(\d+)", bhk.strip())
    return int(m.group(1)) if m else None


# ─────────────────────────────────────────────
# 2. Quality Rescoring — 4 Dimensions
# ─────────────────────────────────────────────

# Source-aware weights: (detail, price_comp, locality_sent, freshness)
WEIGHTS = {
    "nobroker":  (20, 35, 30, 15),
    "housing":   (20, 35, 30, 15),
    "99acres":   (20, 35, 30, 15),
    "reddit":    (20, 30, 20, 30),
    "telegram":  (20, 30, 20, 30),
}
DEFAULT_WEIGHTS = (20, 30, 25, 25)

DETAIL_FIELDS = [
    "rent", "bhk", "locality", "furnishing", "deposit",
    "area_sqft", "floor_info", "contact_phone", "address",
    "amenities", "property_type",
]

FRESHNESS_DECAY = 0.05  # e^(-0.05 * age_days) — 7-day listing keeps ~70%


def run_quality_rescoring():
    """
    Compute 4-dimension quality score for all active/stale listings
    and write to listings_curated.
    """
    started_at = datetime.now(timezone.utc)
    run_id = record_transform_start("quality_rescoring")
    processed = 0

    try:
        conn = get_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        locality_stats = _load_locality_stats(conn)
        locality_sentiment = _load_locality_sentiment(conn)

        cur.execute("""
            SELECT l.id, l.source, l.rent, l.bhk, l.locality, l.furnishing,
                   l.deposit, l.area_sqft, l.floor_info, l.contact_phone,
                   l.address, l.amenities, l.property_type, l.first_seen_at,
                   l.status, lc.is_listing
            FROM listings l
            LEFT JOIN listings_curated lc ON lc.listing_id = l.id
            WHERE l.status IN ('active', 'stale')
        """)
        rows = cur.fetchall()
        processed = len(rows)

        update_cur = conn.cursor()
        for row in rows:
            # Non-listings get zeroed out
            if row["is_listing"] is False:
                update_cur.execute("""
                    INSERT INTO listings_curated
                        (listing_id, quality_score, detail_score, price_comp_score,
                         locality_sent_score, freshness_score, updated_at)
                    VALUES (%s, 0, 0, 0, 0, 0, NOW())
                    ON CONFLICT (listing_id) DO UPDATE SET
                        quality_score = 0, detail_score = 0, price_comp_score = 0,
                        locality_sent_score = 0, freshness_score = 0, updated_at = NOW()
                """, (row["id"],))
                continue

            source = row["source"]
            w_detail, w_price, w_sent, w_fresh = WEIGHTS.get(source, DEFAULT_WEIGHTS)

            detail = _score_detail(row, w_detail)
            price_comp = _score_price_competitiveness(row, locality_stats, w_price)
            sent = _score_locality_sentiment(row, locality_sentiment, w_sent)
            fresh = _score_freshness(row, w_fresh)

            total = detail + price_comp + sent + fresh

            update_cur.execute("""
                INSERT INTO listings_curated
                    (listing_id, quality_score, detail_score, price_comp_score,
                     locality_sent_score, freshness_score, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (listing_id) DO UPDATE SET
                    quality_score       = EXCLUDED.quality_score,
                    detail_score        = EXCLUDED.detail_score,
                    price_comp_score    = EXCLUDED.price_comp_score,
                    locality_sent_score = EXCLUDED.locality_sent_score,
                    freshness_score     = EXCLUDED.freshness_score,
                    updated_at          = NOW()
            """, (row["id"], total, detail, price_comp, sent, fresh))

        conn.commit()
        conn.close()

        record_transform_end(
            run_id, status="success",
            records_processed=processed,
            started_at=started_at,
        )
        logger.info("Quality rescoring complete: %d listings scored", processed)
    except Exception as e:
        logger.error("Quality rescoring failed: %s", e)
        record_transform_end(run_id, status="failed", error_message=str(e), started_at=started_at)
        raise


def _load_locality_stats(conn) -> dict:
    """Load locality_stats_cache into a dict keyed by (locality, bhk)."""
    cur = conn.cursor()
    cur.execute("""
        SELECT locality, bhk, median_rent, median_price_per_sqft
        FROM locality_stats_cache
    """)
    result = {}
    for locality, bhk, median_rent, median_ppsf in cur.fetchall():
        result[(locality, bhk)] = {
            "median_rent": median_rent,
            "median_ppsf": float(median_ppsf) if median_ppsf else None,
        }
    return result


def _load_locality_sentiment(conn) -> dict:
    """Load 30-day rolling avg sentiment per locality from locality_feed.

    The query mirrors what /api/pulse/feed and /api/pulse/locality/<loc> use,
    so the sentiment value displayed on the Pulse pages is the same one that
    feeds locality_sent_score on every listing. Filters:

      * 30-day rolling window
      * category IN ('discussion', 'news') — ignore classifieds / spam
      * relevance_score >= 0.3 — ignore passing mentions
      * post counts both via the direct `locality` column AND any locality
        listed in `detected_localities`, deduplicated by post id
      * 'Bengaluru General' / 'Bangalore General' are catch-all buckets the
        tagger uses for city-wide posts; not real neighbourhoods, so excluded.
    """
    cur = conn.cursor()
    cur.execute("""
        WITH expanded AS (
            SELECT id, locality, sentiment_score
            FROM locality_feed
            WHERE category IN ('discussion', 'news')
              AND locality IS NOT NULL
              AND sentiment_score IS NOT NULL
              AND relevance_score >= 0.3
              AND scraped_at >= NOW() - INTERVAL '30 days'
            UNION
            SELECT id, unnest(detected_localities) AS locality, sentiment_score
            FROM locality_feed
            WHERE category IN ('discussion', 'news')
              AND detected_localities IS NOT NULL
              AND array_length(detected_localities, 1) > 0
              AND sentiment_score IS NOT NULL
              AND relevance_score >= 0.3
              AND scraped_at >= NOW() - INTERVAL '30 days'
        )
        SELECT locality, AVG(sentiment_score) AS avg_sent
        FROM expanded
        WHERE locality NOT ILIKE 'bengaluru general'
          AND locality NOT ILIKE 'bangalore general'
        GROUP BY locality
    """)
    result = {}
    for locality, avg_sent in cur.fetchall():
        result[locality] = float(avg_sent) if avg_sent else 0.5
    return result


STRUCTURED_SOURCES = {"nobroker", "housing", "99acres"}

def _score_detail(row: dict, max_score: int) -> int:
    """Score listing completeness (0 to max_score).
    Structured sources get a base bonus since their data is verified."""
    filled = 0
    total = len(DETAIL_FIELDS)
    for field in DETAIL_FIELDS:
        val = row.get(field)
        if val is not None:
            if isinstance(val, (list, tuple)):
                if len(val) > 0:
                    filled += 1
            elif isinstance(val, str):
                if val.strip():
                    filled += 1
            else:
                filled += 1

    ratio = filled / total
    source = row.get("source", "")
    if source in STRUCTURED_SOURCES:
        # Structured sources: base 40% + 60% from field completeness
        return round((0.4 + 0.6 * ratio) * max_score)
    return round(ratio * max_score)


def _score_price_competitiveness(row: dict, stats: dict, max_score: int) -> int:
    """
    Score how competitive the rent is vs locality+BHK median.
    Area-adjusted when area_sqft is available.
    """
    rent = row.get("rent")
    locality = row.get("locality")
    bhk = row.get("bhk")
    area = row.get("area_sqft")

    if not rent or not locality or not bhk:
        return max_score // 2

    key = (locality, bhk)
    loc_stats = stats.get(key)
    if not loc_stats:
        return max_score // 2

    if area and area >= 100 and loc_stats.get("median_ppsf"):
        listing_ppsf = rent / area
        median_ppsf = loc_stats["median_ppsf"]
        if median_ppsf > 0:
            ratio = listing_ppsf / median_ppsf
        else:
            ratio = 1.0
    else:
        median_rent = loc_stats.get("median_rent")
        if not median_rent or median_rent <= 0:
            return max_score // 2
        ratio = rent / median_rent

    # ratio < 1 = cheaper than median (good), ratio > 1 = expensive
    # Curve: 0.5 → max, 1.0 → 70% of max (good deal at market rate),
    #         1.3 → 30%, 1.6+ → 0
    if ratio <= 0.5:
        return max_score
    elif ratio <= 1.0:
        # 0.5→100%, 1.0→70% — gentle slope for at-or-below market
        pct = 1.0 - 0.3 * ((ratio - 0.5) / 0.5)
        return round(pct * max_score)
    elif ratio <= 1.6:
        # 1.0→70%, 1.6→0% — steeper penalty for above market
        pct = 0.7 * (1.0 - (ratio - 1.0) / 0.6)
        return max(0, round(pct * max_score))
    else:
        return 0


def _score_locality_sentiment(row: dict, sentiment: dict, max_score: int) -> int:
    """Score based on locality's rolling avg sentiment.
    sentiment_score ranges -1 to +1. Map so that:
      -1.0 → 0, 0.0 → 60% of max (neutral is okay), +1.0 → max
    """
    locality = row.get("locality")
    if not locality or locality not in sentiment:
        return round(max_score * 0.5)

    avg_sent = sentiment[locality]  # range: -1.0 to +1.0
    # Linear map: -1→0%, 0→60%, +1→100%
    if avg_sent >= 0:
        pct = 0.6 + 0.4 * avg_sent
    else:
        pct = 0.6 + 0.6 * avg_sent  # -1 → 0%, -0.5 → 30%, 0 → 60%
    return max(0, round(pct * max_score))


def _score_freshness(row: dict, max_score: int) -> int:
    """Exponential decay: max_score * e^(-0.1 * age_days)."""
    first_seen = row.get("first_seen_at")
    if not first_seen:
        return 0

    now = datetime.now(timezone.utc)
    if first_seen.tzinfo is None:
        from datetime import timezone as tz
        first_seen = first_seen.replace(tzinfo=tz.utc)

    age_days = (now - first_seen).total_seconds() / 86400
    score = max_score * math.exp(-FRESHNESS_DECAY * age_days)
    return round(score)


# ─────────────────────────────────────────────
# 3. Cross-Source Deduplication
# ─────────────────────────────────────────────

RENT_TOLERANCE = 0.05
AREA_TOLERANCE_SQFT = 30

import re

_NOISE_WORDS = {
    "bangalore", "bengaluru", "karnataka", "india", "independent", "house",
    "standalone", "building", "flat", "apartment", "road", "rd",
    "near", "opp", "opposite", "behind", "beside", "next",
    "layout", "nagar", "colony", "area", "street", "st",
    "and", "the", "of", "in", "at", "to", "for", "a", "an",
    "sector", "phase", "block", "stage", "cross", "main", "part",
}

_SECTOR_RE  = re.compile(r"\bsector\s*\d+\b", re.I)
_PHASE_RE   = re.compile(r"\b(?:phase|block|stage|part)\s*\d+\b", re.I)
_ORDINAL_RE = re.compile(r"\b\d+(?:st|nd|rd|th)\s+(?:block|stage|phase|cross|main)\b", re.I)
_PINCODE_RE = re.compile(r"\b\d{6}\b")


def _address_tokens(address: str | None, locality: str | None = None) -> set[str]:
    if not address:
        return set()
    addr = address.lower()
    if locality:
        addr = addr.replace(locality.strip().lower(), "")

    tokens: set[str] = set()
    for pat in (_SECTOR_RE, _PHASE_RE, _ORDINAL_RE):
        for m in pat.finditer(addr):
            tokens.add(re.sub(r"\s+", " ", m.group().strip()))
    for m in _PINCODE_RE.finditer(addr):
        tokens.add(m.group())

    orig = address
    if locality:
        orig = re.sub(re.escape(locality.strip()), "", orig, flags=re.I)
    for word in re.findall(r"[A-Z][a-zA-Z]{3,}", orig):
        w = word.lower()
        if w not in _NOISE_WORDS:
            tokens.add(w)
    return tokens


def run_cross_source_dedup():
    """
    Cross-source deduplication. Finds listings for the same flat on
    different sources and groups them under a shared duplicate_group_id.
    """
    started_at = datetime.now(timezone.utc)
    run_id = record_transform_start("cross_source_dedup")
    groups_found = 0
    listings_grouped = 0

    try:
        conn = get_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cur.execute("""
            SELECT id, source, locality, bhk, rent, area_sqft, address,
                   quality_score, duplicate_group_id
            FROM listings
            WHERE status = 'active'
              AND last_seen_at > NOW() - INTERVAL '48 hours'
              AND locality IS NOT NULL
              AND bhk IS NOT NULL
              AND rent IS NOT NULL
            ORDER BY quality_score DESC
        """)
        rows = cur.fetchall()

        buckets: dict[tuple, list[dict]] = defaultdict(list)
        for row in rows:
            key = (
                (row["locality"] or "").strip().lower(),
                (row["bhk"] or "").strip().lower().replace(" ", ""),
            )
            buckets[key].append(dict(row))

        assigned: dict[int, int] = {}
        groups: dict[int, list[int]] = {}

        for key, group in buckets.items():
            if len(group) < 2:
                continue
            for a, b in combinations(group, 2):
                if a["source"] == b["source"]:
                    continue
                if a["id"] in assigned or b["id"] in assigned:
                    continue
                if not _is_dedup_match(a, b):
                    continue
                canonical = a if (a["quality_score"] or 0) >= (b["quality_score"] or 0) else b
                other = b if canonical is a else a
                gid = canonical["id"]
                assigned[canonical["id"]] = gid
                assigned[other["id"]] = gid
                groups[gid] = [canonical["id"], other["id"]]

        groups_found = len(groups)

        update_cur = conn.cursor()

        for root, members in groups.items():
            for listing_id in members:
                update_cur.execute(
                    "UPDATE listings SET duplicate_group_id = %s WHERE id = %s",
                    (root, listing_id),
                )
                update_cur.execute("""
                    INSERT INTO listings_curated (listing_id, duplicate_group_id, updated_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (listing_id) DO UPDATE SET
                        duplicate_group_id = EXCLUDED.duplicate_group_id,
                        updated_at = NOW()
                """, (listing_id, root))
                listings_grouped += 1

        grouped_ids = {lid for members in groups.values() for lid in members}
        cur2 = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur2.execute("""
            SELECT id FROM listings
            WHERE duplicate_group_id IS NOT NULL
              AND status = 'active'
              AND last_seen_at > NOW() - INTERVAL '48 hours'
        """)
        previously_grouped = {row["id"] for row in cur2.fetchall()}
        stale_groups = previously_grouped - grouped_ids
        if stale_groups:
            update_cur.execute(
                "UPDATE listings SET duplicate_group_id = NULL WHERE id = ANY(%s)",
                (list(stale_groups),),
            )

        conn.commit()
        conn.close()

        record_transform_end(
            run_id, status="success",
            records_processed=len(rows),
            started_at=started_at,
            metadata={
                "groups_found": groups_found,
                "listings_grouped": listings_grouped,
                "stale_cleared": len(stale_groups) if stale_groups else 0,
            },
        )
        logger.info("Dedup: %d groups, %d listings grouped", groups_found, listings_grouped)
    except Exception as e:
        logger.error("Cross-source dedup failed: %s", e)
        record_transform_end(run_id, status="failed", error_message=str(e), started_at=started_at)
        raise


def _is_dedup_match(a: dict, b: dict) -> bool:
    """High-confidence cross-source duplicate check."""
    if not a["locality"] or not b["locality"]:
        return False
    if a["locality"].strip().lower() != b["locality"].strip().lower():
        return False
    if not a["bhk"] or not b["bhk"]:
        return False
    if a["bhk"].strip().lower().replace(" ", "") != b["bhk"].strip().lower().replace(" ", ""):
        return False

    r1, r2 = a["rent"], b["rent"]
    if r1 is None or r2 is None:
        return False
    hi = max(r1, r2)
    if hi > 0 and (hi - min(r1, r2)) / hi > RENT_TOLERANCE:
        return False

    a1, a2 = a["area_sqft"], b["area_sqft"]
    if a1 is None or a2 is None:
        return False
    if abs(a1 - a2) > AREA_TOLERANCE_SQFT:
        return False

    tokens_a = _address_tokens(a["address"], a.get("locality"))
    tokens_b = _address_tokens(b["address"], b.get("locality"))
    if tokens_a and tokens_b and not (tokens_a & tokens_b):
        return False

    return True


# ─────────────────────────────────────────────
# Runner — called by Railway Cron
# ─────────────────────────────────────────────

def main():
    """Run all slow-path transforms in order."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    logger.info("Starting slow-path transforms")

    run_rent_anomaly_flagging()
    run_quality_rescoring()
    run_cross_source_dedup()

    logger.info("Slow-path transforms complete")


if __name__ == "__main__":
    main()
