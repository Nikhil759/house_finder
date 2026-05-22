"""
SQLite Replica Query Helpers
============================

Centralized read queries against the local SQLite replica.
Each function opens and closes its own connection. Exceptions propagate
to the caller so the endpoint's try/except can trigger Supabase fallback.
"""

import json
import logging
import math
import statistics
from datetime import datetime, timezone
from typing import List, Optional

from local_replica import get_connection

logger = logging.getLogger(__name__)


def get_locality_image(locality: str) -> Optional[dict]:
    """Return hero image for a locality, or None if not found."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT image_url, attribution FROM locality_images WHERE LOWER(locality) = LOWER(?)",
            (locality,),
        ).fetchone()
        if row:
            return {"image_url": row["image_url"], "attribution": row["attribution"]}
        return None
    finally:
        conn.close()


def get_locality_stats(locality: str) -> dict:
    """Return rent stats + deposit stats for a single locality."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT bhk, median_rent, p25_rent, p75_rent, listing_count,
                   rent_trend_pct, median_price_per_sqft, updated_at
            FROM locality_stats_cache
            WHERE LOWER(locality) = LOWER(?)
            ORDER BY bhk
            """,
            (locality,),
        ).fetchall()
        rent_stats = [dict(r) for r in rows]

        dep_rows = conn.execute(
            "SELECT bhk, avg_multiplier, median_deposit FROM deposit_stats_cache ORDER BY bhk"
        ).fetchall()
        deposit_stats = [dict(r) for r in dep_rows]

        return {
            "locality": locality,
            "rent_stats": rent_stats,
            "deposit_stats": deposit_stats,
        }
    finally:
        conn.close()


def get_all_locality_stats() -> dict:
    """Return all locality stats + deposit benchmarks."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT locality, bhk, median_rent, p25_rent, p75_rent,
                   listing_count, rent_trend_pct, median_price_per_sqft, updated_at
            FROM locality_stats_cache
            ORDER BY median_rent DESC
            """
        ).fetchall()
        locality_stats = [dict(r) for r in rows]

        dep_rows = conn.execute(
            "SELECT bhk, avg_multiplier, median_deposit FROM deposit_stats_cache ORDER BY bhk"
        ).fetchall()
        deposit_stats = [dict(r) for r in dep_rows]

        return {"locality_stats": locality_stats, "deposit_stats": deposit_stats}
    finally:
        conn.close()


def get_rent_overview() -> List[dict]:
    """Return rent overview data for the Pulse sidebar."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT locality, bhk, median_rent, rent_trend_pct
            FROM locality_stats_cache
            WHERE median_rent IS NOT NULL
            ORDER BY median_rent DESC
            """
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ══════════════════════════════════════════════════════════════════════════════
# Phase 3b: Listings search helpers
# ══════════════════════════════════════════════════════════════════════════════


def _json_loads_safe(val):
    """Parse a JSON string from SQLite. Returns the parsed object or val as-is."""
    if val is None:
        return None
    if isinstance(val, str):
        try:
            return json.loads(val)
        except (json.JSONDecodeError, TypeError):
            return None
    return val


def build_image_list_replica(images_jsonb, image_urls, society_place_id, locality):
    """
    Build a unified image list for a listing response (SQLite replica version).

    Priority order:
      1. images jsonb (NoBroker interior shots with full metadata)
      2. image_urls fallback -> converted to same structure
      3. society_images for society_place_id (society exterior)
      4. locality_images for locality (locality hero, always last)
    """
    result = []

    if images_jsonb:
        entries = images_jsonb if isinstance(images_jsonb, list) else []
        result.extend(entries)
    elif image_urls:
        for url in image_urls:
            if url and url.strip():
                result.append({
                    "url": url,
                    "source": "nobroker",
                    "image_type": "listing_interior",
                    "attribution": "NoBroker",
                })

    if society_place_id:
        conn = get_connection()
        try:
            soc_row = conn.execute(
                "SELECT image_urls FROM society_images WHERE place_id = ? LIMIT 1",
                (society_place_id,),
            ).fetchone()
            if soc_row and soc_row["image_urls"]:
                urls = _json_loads_safe(soc_row["image_urls"]) or []
                for url in urls:
                    if url and url.strip():
                        result.append({
                            "url": url,
                            "source": "google_places",
                            "image_type": "society_exterior",
                            "attribution": "Google",
                        })
        finally:
            conn.close()

    if locality:
        conn = get_connection()
        try:
            loc_row = conn.execute(
                "SELECT image_url FROM locality_images WHERE locality = ? LIMIT 1",
                (locality,),
            ).fetchone()
            if loc_row and loc_row["image_url"]:
                result.append({
                    "url": loc_row["image_url"],
                    "source": "google_places",
                    "image_type": "locality_hero",
                    "attribution": "Google",
                })
        finally:
            conn.close()

    return result


def query_listings_replica(
    localities=None,
    sources=None,
    bhk=None,
    budget=None,
    min_budget=None,
    limit=50,
    include_expired=False,
    since_utc=None,
    listing_type=None,
) -> List[dict]:
    """
    SQLite replica version of query_listings() from listing_store.py.
    Same signature, same return shape.
    """
    conn = get_connection()
    try:
        conditions = []
        params = []

        if not include_expired:
            conditions.append("l.status = ?")
            params.append("active")

        if listing_type:
            conditions.append("l.listing_type = ?")
            params.append(listing_type)

        if sources:
            placeholders = ",".join(["?"] * len(sources))
            conditions.append(f"l.source IN ({placeholders})")
            params.extend(sources)

        if localities:
            placeholders = ",".join(["?"] * len(localities))
            conditions.append(f"LOWER(l.locality) IN ({placeholders})")
            params.extend([loc.lower() for loc in localities])

        if bhk and bhk != "any":
            conditions.append("LOWER(REPLACE(l.bhk, ' ', '')) LIKE ?")
            params.append(f"%{bhk.lower().replace(' ', '')}%")

        if budget:
            try:
                budget_val = int(budget)
                conditions.append("(l.rent IS NULL OR l.rent <= ?)")
                params.append(budget_val)
            except ValueError:
                pass

        if min_budget:
            try:
                min_budget_val = int(min_budget)
                conditions.append("(l.rent IS NULL OR l.rent >= ?)")
                params.append(min_budget_val)
            except ValueError:
                pass

        conditions.append("(l.rent IS NULL OR (l.rent >= 2000 AND l.rent <= 150000))")
        conditions.append(
            "(l.duplicate_group_id IS NULL OR l.id = l.duplicate_group_id)"
        )
        conditions.append("(lc.is_listing IS NULL OR lc.is_listing = 1)")

        if since_utc is not None:
            conditions.append("CAST(strftime('%s', l.posted_at) AS REAL) > ?")
            params.append(since_utc)

        where = " AND ".join(conditions) if conditions else "1=1"

        PER_SOURCE_CAP = 30

        sql = f"""
            WITH ranked AS (
                SELECT l.source, l.source_id, l.source_url, l.source_group,
                       l.title, l.body, l.bhk, l.property_type, l.furnishing,
                       l.rent, l.deposit, l.maintenance,
                       l.locality, l.address, l.latitude, l.longitude, l.maps_url,
                       l.area_sqft, l.floor_info, l.amenities, l.lease_type,
                       l.contact_phone, l.contact_name, l.is_broker, l.no_brokerage,
                       l.is_flatmate, l.is_sponsored, l.thumbnail_url,
                       CAST(strftime('%s', l.posted_at) AS REAL) AS posted_epoch,
                       COALESCE(lc.quality_score, l.quality_score) AS quality_score,
                       l.raw_payload,
                       l.id, l.duplicate_group_id,
                       lc.detail_score, lc.price_comp_score,
                       lc.locality_sent_score, lc.freshness_score,
                       lc.price_anomaly, lc.is_per_room, lc.rent_type,
                       (CASE WHEN l.image_urls IS NOT NULL AND json_valid(l.image_urls)
                             THEN json_array_length(l.image_urls) ELSE 0 END
                        + CASE WHEN l.images IS NOT NULL AND json_valid(l.images)
                             THEN json_array_length(l.images) ELSE 0 END) AS image_count,
                       l.listing_type, l.type_attributes,
                       ROW_NUMBER() OVER (
                           PARTITION BY l.source
                           ORDER BY COALESCE(lc.quality_score, l.quality_score) DESC
                       ) AS rn
                FROM listings l
                LEFT JOIN listings_curated lc ON lc.listing_id = l.id
                WHERE {where}
            )
            SELECT source, source_id, source_url, source_group,
                   title, body, bhk, property_type, furnishing,
                   rent, deposit, maintenance,
                   locality, address, latitude, longitude, maps_url,
                   area_sqft, floor_info, amenities, lease_type,
                   contact_phone, contact_name, is_broker, no_brokerage,
                   is_flatmate, is_sponsored, thumbnail_url,
                   posted_epoch, quality_score, raw_payload,
                   id, duplicate_group_id,
                   detail_score, price_comp_score,
                   locality_sent_score, freshness_score,
                   price_anomaly, is_per_room, rent_type,
                   image_count,
                   listing_type, type_attributes
            FROM ranked
            WHERE rn <= ?
            ORDER BY quality_score DESC
        """
        params.append(PER_SOURCE_CAP)

        cur = conn.execute(sql, params)
        rows = cur.fetchall()

        canonical_with_group = {}
        for row in rows:
            listing_id = row[31]
            dup_group_id = row[32]
            if dup_group_id is not None:
                canonical_with_group[listing_id] = dup_group_id

        sibling_map = {}
        if canonical_with_group:
            group_ids = list(set(canonical_with_group.values()))
            placeholders = ",".join(["?"] * len(group_ids))
            sib_rows = conn.execute(
                f"""
                SELECT duplicate_group_id, source, source_url
                FROM listings
                WHERE duplicate_group_id IN ({placeholders})
                  AND status = 'active'
                ORDER BY quality_score DESC
                """,
                group_ids,
            ).fetchall()
            for sib_row in sib_rows:
                grp_id = sib_row[0]
                src = sib_row[1]
                url = sib_row[2]
                sibling_map.setdefault(grp_id, []).append({"source": src, "url": url})

        results = []
        for row in rows:
            listing_id = row[31]
            dup_group_id = row[32]
            siblings = []
            if dup_group_id is not None:
                all_in_group = sibling_map.get(dup_group_id, [])
                current_source = row[0]
                siblings = [s for s in all_in_group if s["source"] != current_source]

            raw_payload = _json_loads_safe(row[30]) or {}
            amenities = _json_loads_safe(row[19]) or []
            type_attributes = _json_loads_safe(row[42]) or {}

            raw_payload.update({
                "id": f"{row[0]}_{row[1]}",
                "source": row[0],
                "source_id": row[1],
                "url": row[2],
                "source_url": row[2],
                "source_group": row[3],
                "title": row[4] or "",
                "body": row[5] or "",
                "selftext": row[5] or "",
                "bhk": row[6],
                "property_type": row[7],
                "furnishing": row[8],
                "price": row[9],
                "rent": row[9],
                "deposit": row[10],
                "maintenance": row[11],
                "locality": row[12],
                "address": row[13],
                "latitude": row[14],
                "longitude": row[15],
                "maps_url": row[16],
                "area_sqft": row[17],
                "floor_info": row[18],
                "amenities": amenities,
                "lease_type": row[20],
                "contact": row[21],
                "contact_phone": row[21],
                "contact_name": row[22],
                "is_broker": bool(row[23]) if row[23] is not None else None,
                "no_brokerage": bool(row[24]) if row[24] is not None else None,
                "is_flatmate": bool(row[25]) if row[25] is not None else None,
                "is_sponsored": bool(row[26]) if row[26] is not None else None,
                "thumbnail_url": row[27],
                "created": row[28] or 0,
                "created_utc": row[28] or 0,
                "quality_score": row[29] or 0,
                "duplicate_sources": siblings,
                "detail_score": row[33],
                "price_comp_score": row[34],
                "locality_sent_score": row[35],
                "freshness_score": row[36],
                "price_anomaly": bool(row[37]) if row[37] is not None else False,
                "is_per_room": bool(row[38]) if row[38] is not None else False,
                "rent_type": row[39] or "unknown",
                "image_count": row[40] or 0,
                "listing_type": row[41] or "full_house",
                "type_attributes": type_attributes,
            })
            results.append(raw_payload)
        return results

    finally:
        conn.close()


def _row_to_listing_replica(row):
    """Convert a wide-SELECT row (46 columns) to a listing dict (SQLite version)."""
    raw_payload = _json_loads_safe(row[30]) or {}
    amenities = _json_loads_safe(row[19]) or []
    image_urls = _json_loads_safe(row[35]) or []
    images = _json_loads_safe(row[36]) or []
    type_attributes = _json_loads_safe(row[45]) or {}

    raw_payload.update({
        "id": f"{row[0]}_{row[1]}",
        "source": row[0],
        "source_id": row[1],
        "url": row[2],
        "source_url": row[2],
        "source_group": row[3],
        "title": row[4] or "",
        "body": row[5] or "",
        "selftext": row[5] or "",
        "bhk": row[6],
        "property_type": row[7],
        "furnishing": row[8],
        "price": row[9],
        "rent": row[9],
        "deposit": row[10],
        "maintenance": row[11],
        "locality": row[12],
        "address": row[13],
        "latitude": row[14],
        "longitude": row[15],
        "maps_url": row[16],
        "area_sqft": row[17],
        "floor_info": row[18],
        "amenities": amenities,
        "lease_type": row[20],
        "contact": row[21],
        "contact_phone": row[21],
        "contact_name": row[22],
        "is_broker": bool(row[23]) if row[23] is not None else None,
        "no_brokerage": bool(row[24]) if row[24] is not None else None,
        "is_flatmate": bool(row[25]) if row[25] is not None else None,
        "is_sponsored": bool(row[26]) if row[26] is not None else None,
        "thumbnail_url": row[27],
        "created": row[28] or 0,
        "created_utc": row[28] or 0,
        "quality_score": row[29] or 0,
        "society_name": row[33],
        "society_place_id": row[34],
        "image_urls": image_urls,
        "images": images,
        "image_list": build_image_list_replica(
            images_jsonb=images,
            image_urls=image_urls,
            society_place_id=row[34],
            locality=row[12],
        ),
        "detail_score": row[37],
        "price_comp_score": row[38],
        "locality_sent_score": row[39],
        "freshness_score": row[40],
        "price_anomaly": bool(row[41]) if row[41] is not None else False,
        "is_per_room": bool(row[42]) if row[42] is not None else False,
        "rent_type": row[43] or "unknown",
        "listing_type": row[44] or "full_house",
        "type_attributes": type_attributes,
        "image_count": len(image_urls) + len(images),
    })
    return raw_payload


_LISTING_SELECT_REPLICA = """
    SELECT l.source, l.source_id, l.source_url, l.source_group,
           l.title, l.body, l.bhk, l.property_type, l.furnishing,
           l.rent, l.deposit, l.maintenance,
           l.locality, l.address, l.latitude, l.longitude, l.maps_url,
           l.area_sqft, l.floor_info, l.amenities, l.lease_type,
           l.contact_phone, l.contact_name, l.is_broker, l.no_brokerage,
           l.is_flatmate, l.is_sponsored, l.thumbnail_url,
           CAST(strftime('%s', l.posted_at) AS REAL) AS posted_epoch,
           COALESCE(lc.quality_score, l.quality_score) AS quality_score,
           l.raw_payload,
           l.id, l.duplicate_group_id,
           l.society_name, l.society_place_id, l.image_urls, l.images,
           lc.detail_score, lc.price_comp_score,
           lc.locality_sent_score, lc.freshness_score,
           lc.price_anomaly, lc.is_per_room, lc.rent_type,
           l.listing_type, l.type_attributes
    FROM listings l
    LEFT JOIN listings_curated lc ON lc.listing_id = l.id
"""


def get_listing_by_id_replica(composite_id: str) -> Optional[dict]:
    """
    SQLite replica version of get_listing_by_id() from listing_store.py.
    Same signature, same return shape.
    """
    if not composite_id:
        return None

    from listing_store import _SOURCE_ALIAS

    if '_' not in composite_id:
        source = None
        source_id = composite_id
    else:
        source, source_id = composite_id.split('_', 1)
        source = _SOURCE_ALIAS.get(source, source)

    conn = get_connection()
    try:
        if source:
            row = conn.execute(
                _LISTING_SELECT_REPLICA + " WHERE l.source = ? AND l.source_id = ? LIMIT 1",
                (source, source_id),
            ).fetchone()
        else:
            row = conn.execute(
                _LISTING_SELECT_REPLICA + " WHERE l.source_id = ? LIMIT 1",
                (source_id,),
            ).fetchone()
        return _row_to_listing_replica(row) if row else None
    finally:
        conn.close()


# ══════════════════════════════════════════════════════════════════════════════
# Phase 3c: Pulse endpoint helpers
# ══════════════════════════════════════════════════════════════════════════════

_LOCALITY_FILTER_SQL = """
    (LOWER(lf.locality) = LOWER(?) OR EXISTS (
        SELECT 1 FROM json_each(lf.detected_localities) WHERE json_each.value = ?
    ))
"""


def _days_since_iso(iso_str):
    """Return fractional days between an ISO timestamp string and now (UTC)."""
    if not iso_str:
        return 999.0
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        delta = datetime.now(timezone.utc) - dt
        return delta.total_seconds() / 86400.0
    except (ValueError, TypeError):
        return 999.0


def pulse_feed_replica(locality=None, topic=None, limit=50) -> dict:
    """SQLite replica of /api/pulse/feed."""
    from pulse_feed_ranking import rank_pulse_feed

    conn = get_connection()
    try:
        where_clauses = [
            "lf.category IN ('discussion', 'news')",
            "lf.relevance_score >= 0.3",
            "lf.sentiment_score IS NOT NULL",
            "strftime('%Y-%m-%d %H:%M:%S', lf.scraped_at) >= strftime('%Y-%m-%d %H:%M:%S', datetime('now', '-7 days'))",
        ]
        params = []

        if locality:
            where_clauses.append(
                "(LOWER(lf.locality) = LOWER(?) OR EXISTS ("
                "SELECT 1 FROM json_each(lf.detected_localities) WHERE json_each.value = ?))"
            )
            params.extend([locality, locality])
        if topic:
            where_clauses.append("lf.canonical_topic = ?")
            params.append(topic)

        where_sql = " AND ".join(where_clauses)

        cur = conn.execute(
            f"""
            SELECT
                lf.id, lf.source, lf.locality, lf.title, lf.body, lf.url,
                lf.category, lf.canonical_topic, lf.sentiment_score,
                lf.relevance_score, lf.detected_localities,
                lf.posted_at, lf.scraped_at, lf.engagement, lf.author,
                fc.featured, fc.editor_rank, fc.editor_note,
                fc.is_trending, fc.trending_score
            FROM feed_curated fc
            JOIN locality_feed lf ON lf.id = fc.feed_id
            WHERE {where_sql}
            ORDER BY fc.featured DESC, fc.editor_rank ASC,
                     lf.relevance_score DESC, lf.scraped_at DESC
            LIMIT ?
            """,
            params + [limit * 4],
        )
        cols = [d[0] for d in cur.description]
        rows = cur.fetchall()

        posts = []
        for row in rows:
            d = dict(zip(cols, row))
            d["detected_localities"] = _json_loads_safe(d.get("detected_localities")) or []
            posts.append(d)

        posts = rank_pulse_feed(posts, limit=limit)

        # City-wide sentiment (7 days)
        row = conn.execute("""
            SELECT AVG(sentiment_score), COUNT(*), MAX(scraped_at)
            FROM locality_feed
            WHERE category IN ('discussion', 'news')
              AND sentiment_score IS NOT NULL
              AND relevance_score >= 0.3
              AND strftime('%Y-%m-%d %H:%M:%S', scraped_at) >= strftime('%Y-%m-%d %H:%M:%S', datetime('now', '-7 days'))
        """).fetchone()
        avg_sent = row[0]
        sent_count = row[1] or 0
        last_scraped = row[2]

        # Per-locality sentiment (30 days) via UNION with json_each
        loc_rows = conn.execute("""
            WITH expanded AS (
                SELECT id, locality, sentiment_score
                FROM locality_feed
                WHERE category IN ('discussion', 'news')
                  AND locality IS NOT NULL
                  AND sentiment_score IS NOT NULL
                  AND relevance_score >= 0.3
                  AND strftime('%Y-%m-%d %H:%M:%S', scraped_at) >= strftime('%Y-%m-%d %H:%M:%S', datetime('now', '-30 days'))
                UNION
                SELECT lf.id, je.value AS locality, lf.sentiment_score
                FROM locality_feed lf, json_each(lf.detected_localities) je
                WHERE lf.category IN ('discussion', 'news')
                  AND lf.detected_localities IS NOT NULL
                  AND json_valid(lf.detected_localities)
                  AND json_array_length(lf.detected_localities) > 0
                  AND lf.sentiment_score IS NOT NULL
                  AND lf.relevance_score >= 0.3
                  AND strftime('%Y-%m-%d %H:%M:%S', lf.scraped_at) >= strftime('%Y-%m-%d %H:%M:%S', datetime('now', '-30 days'))
            )
            SELECT locality, AVG(sentiment_score) AS avg_sent, COUNT(*) AS cnt
            FROM expanded
            WHERE LOWER(locality) != 'bengaluru general'
              AND LOWER(locality) != 'bangalore general'
            GROUP BY locality
            ORDER BY cnt DESC
            LIMIT 20
        """).fetchall()
        locality_sentiments = [
            {"locality": r[0], "avg_sentiment": round(float(r[1]), 3), "count": r[2]}
            for r in loc_rows
        ]

        return {
            "posts": posts,
            "city_sentiment": round(float(avg_sent), 3) if avg_sent else 0,
            "city_sentiment_count": sent_count,
            "city_sentiment_updated_at": last_scraped,
            "locality_sentiments": locality_sentiments,
        }
    finally:
        conn.close()


def pulse_topics_replica() -> dict:
    """SQLite replica of /api/pulse/topics."""
    conn = get_connection()
    try:
        rows = conn.execute("""
            SELECT
                lf.canonical_topic,
                COUNT(*) AS post_count,
                AVG(lf.sentiment_score) AS avg_sentiment
            FROM feed_curated fc
            JOIN locality_feed lf ON lf.id = fc.feed_id
            WHERE lf.canonical_topic IS NOT NULL
              AND lf.canonical_topic != 'other'
              AND strftime('%Y-%m-%d %H:%M:%S', lf.scraped_at) >= strftime('%Y-%m-%d %H:%M:%S', datetime('now', '-30 days'))
            GROUP BY lf.canonical_topic
            ORDER BY post_count DESC
        """).fetchall()
        topics = []
        for slug, count, avg_sent in rows:
            topics.append({
                "slug": slug,
                "label": slug.replace("_", " ").title(),
                "count": count,
                "avg_sentiment": round(float(avg_sent), 3) if avg_sent else 0,
            })
        return {"topics": topics}
    finally:
        conn.close()


def pulse_trending_replica() -> dict:
    """SQLite replica of /api/pulse/trending."""
    conn = get_connection()
    try:
        rows = conn.execute("""
            SELECT
                lf.id, lf.source, lf.locality, lf.title, lf.body, lf.url,
                lf.category, lf.canonical_topic, lf.sentiment_score,
                lf.relevance_score, lf.detected_localities,
                lf.posted_at, lf.scraped_at, lf.engagement,
                fc.trending_score
            FROM feed_curated fc
            JOIN locality_feed lf ON lf.id = fc.feed_id
            WHERE fc.is_trending = 1
            ORDER BY fc.trending_score DESC
        """).fetchall()
        cols = ["id", "source", "locality", "title", "body", "url",
                "category", "canonical_topic", "sentiment_score",
                "relevance_score", "detected_localities",
                "posted_at", "scraped_at", "engagement", "trending_score"]
        result = []
        for row in rows:
            d = dict(zip(cols, row))
            d["detected_localities"] = _json_loads_safe(d.get("detected_localities")) or []
            result.append(d)
        return {"trending": result}
    finally:
        conn.close()


def pulse_locality_replica(locality: str) -> dict:
    """SQLite replica of /api/pulse/locality/<locality>."""
    conn = get_connection()
    try:
        # 30-day avg sentiment
        row = conn.execute(
            """
            SELECT AVG(sentiment_score), COUNT(*)
            FROM locality_feed
            WHERE (LOWER(locality) = LOWER(?) OR EXISTS (
                SELECT 1 FROM json_each(detected_localities) WHERE json_each.value = ?
            ))
              AND category IN ('discussion', 'news')
              AND sentiment_score IS NOT NULL
              AND relevance_score >= 0.3
              AND strftime('%Y-%m-%d %H:%M:%S', scraped_at) >= strftime('%Y-%m-%d %H:%M:%S', datetime('now', '-30 days'))
            """,
            (locality, locality),
        ).fetchone()
        avg_sent = row[0]
        post_count_30d = row[1] or 0

        # Top topics (30 days)
        topic_rows = conn.execute(
            """
            SELECT canonical_topic, COUNT(*) AS cnt, AVG(sentiment_score) AS avg_sent
            FROM locality_feed
            WHERE (LOWER(locality) = LOWER(?) OR EXISTS (
                SELECT 1 FROM json_each(detected_localities) WHERE json_each.value = ?
            ))
              AND canonical_topic IS NOT NULL
              AND canonical_topic != 'other'
              AND strftime('%Y-%m-%d %H:%M:%S', scraped_at) >= strftime('%Y-%m-%d %H:%M:%S', datetime('now', '-30 days'))
            GROUP BY canonical_topic
            ORDER BY cnt DESC
            LIMIT 8
            """,
            (locality, locality),
        ).fetchall()
        topics = [
            {"slug": slug, "label": slug.replace("_", " ").title(),
             "count": cnt, "avg_sentiment": round(float(s), 3) if s else 0}
            for slug, cnt, s in topic_rows
        ]

        # Recent high-relevance posts
        post_rows = conn.execute(
            """
            SELECT id, source, locality, title, body, url,
                   category, canonical_topic, sentiment_score,
                   relevance_score, posted_at, scraped_at, engagement
            FROM locality_feed
            WHERE (LOWER(locality) = LOWER(?) OR EXISTS (
                SELECT 1 FROM json_each(detected_localities) WHERE json_each.value = ?
            ))
              AND category IN ('discussion', 'news')
              AND relevance_score >= 0.4
            ORDER BY scraped_at DESC
            LIMIT 20
            """,
            (locality, locality),
        ).fetchall()
        cols = ["id", "source", "locality", "title", "body", "url",
                "category", "canonical_topic", "sentiment_score",
                "relevance_score", "posted_at", "scraped_at", "engagement"]
        posts = [dict(zip(cols, r)) for r in post_rows]

        return {
            "locality": locality,
            "avg_sentiment_30d": round(float(avg_sent), 3) if avg_sent else None,
            "post_count_30d": post_count_30d,
            "avg_sentiment_7d": round(float(avg_sent), 3) if avg_sent else None,
            "post_count_7d": post_count_30d,
            "topics": topics,
            "recent_posts": posts,
        }
    finally:
        conn.close()


def pulse_feed_for_locality_replica(locality: str) -> dict:
    """SQLite replica of /api/pulse/feed-for-locality/<locality>."""
    conn = get_connection()
    try:
        # Topic counts (30 days)
        topic_rows = conn.execute(
            """
            SELECT canonical_topic, COUNT(*) AS cnt
            FROM locality_feed
            WHERE (LOWER(locality) = LOWER(?) OR EXISTS (
                SELECT 1 FROM json_each(detected_localities) WHERE json_each.value = ?
            ))
              AND canonical_topic IS NOT NULL
              AND strftime('%Y-%m-%d %H:%M:%S', scraped_at) >= strftime('%Y-%m-%d %H:%M:%S', datetime('now', '-30 days'))
            GROUP BY canonical_topic
            ORDER BY cnt DESC
            """,
            (locality, locality),
        ).fetchall()
        topics = [{"topic": t, "count": c} for t, c in topic_rows]

        # Recent posts
        post_rows = conn.execute(
            """
            SELECT id, source, author, locality, title, body, url,
                   canonical_topic AS topic, sentiment_score AS sentiment,
                   engagement, posted_at
            FROM locality_feed
            WHERE (LOWER(locality) = LOWER(?) OR EXISTS (
                SELECT 1 FROM json_each(detected_localities) WHERE json_each.value = ?
            ))
              AND canonical_topic IS NOT NULL
              AND sentiment_score IS NOT NULL
            ORDER BY posted_at DESC
            LIMIT 30
            """,
            (locality, locality),
        ).fetchall()
        cols = ["id", "source", "author", "locality", "title", "body", "url",
                "topic", "sentiment", "engagement", "posted_at"]
        posts = [dict(zip(cols, r)) for r in post_rows]

        return {"topics": topics, "posts": posts}
    finally:
        conn.close()


def bangalore_rent_trend_replica() -> dict:
    """SQLite replica of /api/pulse/bangalore-rent-trend."""
    conn = get_connection()
    try:
        # Current period: active/stale listings
        cur_rows = conn.execute("""
            SELECT bhk, rent FROM listings
            WHERE status IN ('active', 'stale')
              AND rent IS NOT NULL
              AND rent BETWEEN 3000 AND 500000
              AND bhk IN ('1 BHK', '2 BHK', '3 BHK')
              AND source IN ('nobroker', 'housing')
              AND listing_type = 'full_house'
        """).fetchall()
        current_rents = {}
        for bhk, rent in cur_rows:
            current_rents.setdefault(bhk, []).append(rent)

        # Previous period: first_seen_at older than 30 days
        prior_rows = conn.execute("""
            SELECT bhk, rent FROM listings
            WHERE strftime('%Y-%m-%d %H:%M:%S', first_seen_at) < strftime('%Y-%m-%d %H:%M:%S', datetime('now', '-30 days'))
              AND rent IS NOT NULL
              AND rent BETWEEN 3000 AND 500000
              AND bhk IN ('1 BHK', '2 BHK', '3 BHK')
              AND source IN ('nobroker', 'housing')
              AND listing_type = 'full_house'
        """).fetchall()
        prior_rents = {}
        for bhk, rent in prior_rows:
            prior_rents.setdefault(bhk, []).append(rent)

        results = []
        for bhk in sorted(current_rents.keys()):
            rents = current_rents[bhk]
            if len(rents) < 30:
                continue
            current_median = int(statistics.median(rents))
            prior_median = None
            trend_pct = None
            if bhk in prior_rents and len(prior_rents[bhk]) >= 30:
                prior_median = int(statistics.median(prior_rents[bhk]))
                if prior_median > 0:
                    trend_pct = round(((current_median - prior_median) / prior_median) * 100, 1)
            results.append({
                "bhk": bhk,
                "current_median": current_median,
                "prior_median": prior_median,
                "listing_count": len(rents),
                "trend_pct": trend_pct,
            })
        return {"bhk_trends": results}
    finally:
        conn.close()
