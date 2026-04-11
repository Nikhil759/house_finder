"""
Persistent listing storage — reads from the new ingestion pipeline schema.

The ingestion cron jobs (Railway) write to the `listings` table.
This module provides read access for the Flask search/health endpoints.
"""

import json
import logging
import os
import sqlite3
import time
import threading

logger = logging.getLogger(__name__)

_DATABASE_URL = os.environ.get("DATABASE_URL", "")
_SQLITE_PATH = os.path.join(os.path.dirname(__file__), "listings.db")

_pg_pool = None
_pool_lock = threading.Lock()


def _use_postgres():
    # Read at call time so load_dotenv() in app.py (which runs after this
    # module is imported) is not missed.
    return bool(os.environ.get("DATABASE_URL", "") or _DATABASE_URL)


def _get_pg_pool():
    """Lazy-init a connection pool (min 1, max 5 connections)."""
    global _pg_pool
    if _pg_pool is not None:
        return _pg_pool
    with _pool_lock:
        if _pg_pool is not None:
            return _pg_pool
        from psycopg2 import pool as pg_pool
        url = os.environ.get("DATABASE_URL", "") or _DATABASE_URL
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        _pg_pool = pg_pool.ThreadedConnectionPool(
            minconn=1, maxconn=5, dsn=url, connect_timeout=10,
            options="-c statement_timeout=15000",
        )
        return _pg_pool


def _get_conn():
    if _use_postgres():
        conn = _get_pg_pool().getconn()
        return conn, True
    else:
        conn = sqlite3.connect(_SQLITE_PATH)
        conn.row_factory = sqlite3.Row
        return conn, False


def _put_conn(conn):
    """Return a pooled Postgres connection."""
    if _use_postgres() and conn:
        try:
            conn.rollback()
            _get_pg_pool().putconn(conn)
        except Exception:
            pass


def init_listings_table():
    """No-op for Postgres — the new schema is managed by migrations."""
    if _use_postgres():
        logger.info("listings table managed by ingestion pipeline (skipping init)")
        return

    conn, _ = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS listings (
                id            TEXT PRIMARY KEY,
                source        TEXT NOT NULL,
                locality      TEXT,
                title         TEXT,
                body          TEXT,
                raw_json      TEXT,
                price         INTEGER,
                bhk           TEXT,
                created_utc   REAL,
                fetched_at    REAL NOT NULL,
                expires_at    REAL NOT NULL
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_listings_source ON listings(source)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_listings_locality ON listings(locality)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_listings_expires ON listings(expires_at)")
        conn.commit()
        logger.info("listings table initialized (sqlite)")
    except Exception as e:
        logger.error("Failed to init listings table: %s", e)
        conn.rollback()
        raise
    finally:
        conn.close()


def _row_to_dict(raw_payload):
    """Convert a raw_payload JSONB/dict or JSON string to a listing dict."""
    if raw_payload is None:
        return None
    if isinstance(raw_payload, dict):
        return raw_payload
    if isinstance(raw_payload, str):
        try:
            return json.loads(raw_payload)
        except (json.JSONDecodeError, TypeError):
            return None
    return None


def upsert_listing(listing: dict, ttl_seconds: int = 10800):
    upsert_listings_batch([listing], ttl_seconds)


def upsert_listings_batch(listings: list, ttl_seconds: int = 10800):
    """
    Legacy upsert for the old in-app ingestion (Telegram daemon, etc.).
    For Postgres, this is now handled by the ingestion pipeline.
    Only used for SQLite (local dev).
    """
    if not listings:
        return

    if _use_postgres():
        logger.debug("upsert_listings_batch: skipped (handled by ingestion pipeline)")
        return

    now = time.time()
    conn, is_pg = _get_conn()
    try:
        cur = conn.cursor()
        for item in listings:
            row = (
                item.get("id", ""),
                item.get("source", ""),
                item.get("locality"),
                item.get("title", ""),
                (item.get("body") or item.get("selftext") or "")[:2000],
                json.dumps(item, default=str),
                _extract_price_int(item),
                item.get("bhk"),
                item.get("created") or item.get("created_utc") or 0,
                now,
                now + ttl_seconds,
            )
            cur.execute("""
                INSERT OR REPLACE INTO listings
                    (id, source, locality, title, body, raw_json,
                     price, bhk, created_utc, fetched_at, expires_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
            """, row)
        conn.commit()
    except Exception as e:
        logger.error("upsert_listings_batch failed: %s", e)
        conn.rollback()
        raise
    finally:
        conn.close()


def _extract_price_int(item):
    p = item.get("price")
    if p is None:
        return None
    if isinstance(p, (int, float)):
        return int(p) if p > 0 else None
    if isinstance(p, str):
        import re
        nums = re.sub(r"[^\d]", "", p)
        return int(nums) if nums else None
    return None


def query_listings(
    localities=None,
    sources=None,
    bhk=None,
    budget=None,
    min_budget=None,
    limit=50,
    include_expired=False,
    since_utc=None,
):
    conn, is_pg = _get_conn()

    if not is_pg:
        return _query_listings_sqlite(
            conn, localities, sources, bhk, budget, min_budget, limit, include_expired, since_utc
        )

    try:
        conditions = []
        params = []

        if not include_expired:
            conditions.append("status = %s")
            params.append("active")

        if sources:
            placeholders = ",".join(["%s"] * len(sources))
            conditions.append(f"source IN ({placeholders})")
            params.extend(sources)

        if localities:
            placeholders = ",".join(["%s"] * len(localities))
            conditions.append(f"LOWER(locality) IN ({placeholders})")
            params.extend([loc.lower() for loc in localities])

        if bhk and bhk != "any":
            conditions.append("LOWER(REPLACE(bhk, ' ', '')) LIKE %s")
            params.append(f"%{bhk.lower().replace(' ', '')}%")

        if budget:
            try:
                budget_val = int(budget)
                conditions.append("(rent IS NULL OR rent <= %s)")
                params.append(budget_val)
            except ValueError:
                pass

        if min_budget:
            try:
                min_budget_val = int(min_budget)
                conditions.append("(rent IS NULL OR rent >= %s)")
                params.append(min_budget_val)
            except ValueError:
                pass

        # Exclude obvious rent anomalies that slipped through ingestion
        # (< ₹2k is garbage; > ₹1.5L is out of range for typical Bangalore rentals)
        conditions.append("(rent IS NULL OR (rent >= 2000 AND rent <= 150000))")

        # Hide non-canonical duplicates: if a listing is in a duplicate group,
        # only show the one with the highest quality_score (the canonical one).
        # The canonical listing has id = duplicate_group_id (set by run_dedup.py).
        conditions.append(
            "(duplicate_group_id IS NULL OR id = duplicate_group_id)"
        )

        if since_utc is not None:
            conditions.append("EXTRACT(EPOCH FROM posted_at) > %s")
            params.append(since_utc)

        where = " AND ".join(conditions) if conditions else "1=1"
        sql = f"""
            SELECT source, source_id, source_url, source_group,
                   title, body, bhk, property_type, furnishing,
                   rent, deposit, maintenance,
                   locality, address, latitude, longitude, maps_url,
                   area_sqft, floor_info, amenities, lease_type,
                   contact_phone, contact_name, is_broker, no_brokerage,
                   is_flatmate, is_sponsored, thumbnail_url,
                   EXTRACT(EPOCH FROM posted_at)::FLOAT as posted_epoch,
                   quality_score, raw_payload,
                   id, duplicate_group_id
            FROM listings
            WHERE {where}
            ORDER BY posted_at DESC NULLS LAST
            LIMIT %s
        """
        params.append(limit)

        cur = conn.cursor()
        cur.execute(sql, params)
        rows = cur.fetchall()

        # Collect canonical listing IDs that have a duplicate group,
        # so we can fetch their sibling sources in one query.
        canonical_with_group = {
            row[31]: row[32]  # id → duplicate_group_id
            for row in rows
            if row[32] is not None  # duplicate_group_id not null
        }

        # Fetch sibling sources for all canonical listings in one query
        sibling_map: dict = {}  # canonical_id → [{source, url}]
        if canonical_with_group:
            group_ids = list(canonical_with_group.values())
            sib_cur = conn.cursor()
            sib_cur.execute("""
                SELECT duplicate_group_id, source, source_url
                FROM listings
                WHERE duplicate_group_id = ANY(%s)
                  AND status = 'active'
                ORDER BY quality_score DESC
            """, (group_ids,))
            for sib_row in sib_cur.fetchall():
                grp_id, src, url = sib_row
                sibling_map.setdefault(grp_id, []).append({"source": src, "url": url})

        results = []
        for row in rows:
            listing_id = row[31]
            dup_group_id = row[32]
            siblings = []
            if dup_group_id is not None:
                all_in_group = sibling_map.get(dup_group_id, [])
                # Exclude self from siblings list
                current_source = row[0]
                siblings = [s for s in all_in_group if s["source"] != current_source]

            base = _row_to_dict(row[30]) or {}
            base.update({
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
                "amenities": row[19] or [],
                "lease_type": row[20],
                "contact": row[21],
                "contact_phone": row[21],
                "contact_name": row[22],
                "is_broker": row[23],
                "no_brokerage": row[24],
                "is_flatmate": row[25],
                "is_sponsored": row[26],
                "thumbnail_url": row[27],
                "created": row[28] or 0,
                "created_utc": row[28] or 0,
                "quality_score": row[29] or 0,
                "duplicate_sources": siblings,
            })
            results.append(base)
        return results

    except Exception as e:
        logger.error("query_listings failed: %s", e)
        return []
    finally:
        _put_conn(conn)


def _query_listings_sqlite(conn, localities, sources, bhk, budget, min_budget, limit, include_expired, since_utc):
    """SQLite fallback for local dev."""
    try:
        conditions = []
        params = []

        if not include_expired:
            conditions.append("expires_at > ?")
            params.append(time.time())

        if sources:
            placeholders = ",".join(["?"] * len(sources))
            conditions.append(f"source IN ({placeholders})")
            params.extend(sources)

        if localities:
            placeholders = ",".join(["?"] * len(localities))
            conditions.append(f"LOWER(locality) IN ({placeholders})")
            params.extend([loc.lower() for loc in localities])

        if bhk and bhk != "any":
            conditions.append("LOWER(REPLACE(bhk, ' ', '')) LIKE ?")
            params.append(f"%{bhk.lower().replace(' ', '')}%")

        if budget:
            try:
                budget_val = int(budget)
                conditions.append("(price IS NULL OR price <= ?)")
                params.append(budget_val)
            except ValueError:
                pass

        if min_budget:
            try:
                min_budget_val = int(min_budget)
                conditions.append("(price IS NULL OR price >= ?)")
                params.append(min_budget_val)
            except ValueError:
                pass

        if since_utc is not None:
            conditions.append("created_utc > ?")
            params.append(since_utc)

        where = " AND ".join(conditions) if conditions else "1=1"
        sql = f"""
            SELECT raw_json FROM listings
            WHERE {where}
            ORDER BY created_utc DESC
            LIMIT ?
        """
        params.append(limit)

        cur = conn.cursor()
        cur.execute(sql, params)
        rows = cur.fetchall()

        results = []
        for row in rows:
            raw = row[0] if isinstance(row, (tuple, list)) else row["raw_json"]
            try:
                results.append(json.loads(raw))
            except (json.JSONDecodeError, TypeError):
                continue
        return results
    except Exception as e:
        logger.error("query_listings (sqlite) failed: %s", e)
        return []
    finally:
        conn.close()


_SOURCE_ALIAS = {
    "nb": "nobroker",
}


_LISTING_SELECT = """
    SELECT source, source_id, source_url, source_group,
           title, body, bhk, property_type, furnishing,
           rent, deposit, maintenance,
           locality, address, latitude, longitude, maps_url,
           area_sqft, floor_info, amenities, lease_type,
           contact_phone, contact_name, is_broker, no_brokerage,
           is_flatmate, is_sponsored, thumbnail_url,
           EXTRACT(EPOCH FROM posted_at)::FLOAT as posted_epoch,
           quality_score, raw_payload,
           id, duplicate_group_id,
           society_name, society_place_id, image_urls, images
    FROM listings
"""


def _build_image_list(
    images_jsonb,       # row[36] — jsonb column, already deserialized by psycopg2
    image_urls,         # row[35] — text[]
    society_place_id,   # row[34]
    locality,           # row[12]
):
    """
    Build a unified image list for a listing response.

    Priority order:
      1. images jsonb column (NoBroker interior shots with full metadata)
      2. image_urls text[] fallback → converted to the same structure
      3. society_images rows for society_place_id (society exterior shots)
      4. locality_images row for locality (locality hero, always last)
    """
    result = []

    # 1 / 2 — listing interior shots
    if images_jsonb:
        entries = images_jsonb if isinstance(images_jsonb, list) else []
        result.extend(entries)
    elif image_urls:
        for url in image_urls:
            if url and url.strip():
                result.append({
                    "url":         url,
                    "source":      "nobroker",
                    "image_type":  "listing_interior",
                    "attribution": "NoBroker",
                })

    # 3 — society exterior shots
    if society_place_id:
        conn, is_pg = _get_conn()
        if is_pg:
            try:
                cur = conn.cursor()
                cur.execute(
                    "SELECT image_urls FROM society_images WHERE place_id = %s LIMIT 1",
                    (society_place_id,),
                )
                soc_row = cur.fetchone()
                if soc_row and soc_row[0]:
                    for url in soc_row[0]:
                        if url and url.strip():
                            result.append({
                                "url":         url,
                                "source":      "google_places",
                                "image_type":  "society_exterior",
                                "attribution": "Google",
                            })
            except Exception as e:
                logger.warning("_build_image_list: society_images query failed: %s", e)
            finally:
                _put_conn(conn)

    # 4 — locality hero (always appended as final fallback)
    if locality:
        conn, is_pg = _get_conn()
        if is_pg:
            try:
                cur = conn.cursor()
                cur.execute(
                    "SELECT image_url FROM locality_images WHERE locality = %s LIMIT 1",
                    (locality,),
                )
                loc_row = cur.fetchone()
                if loc_row and loc_row[0]:
                    result.append({
                        "url":         loc_row[0],
                        "source":      "google_places",
                        "image_type":  "locality_hero",
                        "attribution": "Google",
                    })
            except Exception as e:
                logger.warning("_build_image_list: locality_images query failed: %s", e)
            finally:
                _put_conn(conn)

    return result


def _row_to_listing(row):
    base = _row_to_dict(row[30]) or {}
    base.update({
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
        "amenities": row[19] or [],
        "lease_type": row[20],
        "contact": row[21],
        "contact_phone": row[21],
        "contact_name": row[22],
        "is_broker": row[23],
        "no_brokerage": row[24],
        "is_flatmate": row[25],
        "is_sponsored": row[26],
        "thumbnail_url": row[27],
        "created": row[28] or 0,
        "created_utc": row[28] or 0,
        "quality_score": row[29] or 0,
        "society_name":      row[33],
        "society_place_id":  row[34],
        "image_urls":        row[35] or [],
        "images":            row[36] or [],
        "image_list": _build_image_list(
            images_jsonb=row[36],
            image_urls=row[35],
            society_place_id=row[34],
            locality=row[12],
        ),
    })
    return base


def _query_single_by_source_id(source_id: str, source: str = None):
    """Look up a listing by source_id, optionally filtered by source."""
    conn, is_pg = _get_conn()
    if not is_pg:
        return None
    try:
        cur = conn.cursor()
        if source:
            cur.execute(
                _LISTING_SELECT + " WHERE source = %s AND source_id = %s LIMIT 1",
                (source, source_id),
            )
        else:
            cur.execute(
                _LISTING_SELECT + " WHERE source_id = %s LIMIT 1",
                (source_id,),
            )
        row = cur.fetchone()
        return _row_to_listing(row) if row else None
    except Exception as e:
        logger.error("_query_single_by_source_id failed: %s", e)
        return None
    finally:
        _put_conn(conn)


def get_listing_by_id(composite_id: str):
    """Return a single listing dict by composite ID (source_sourceid)."""
    if not composite_id:
        return None

    if '_' not in composite_id:
        # Bare ID with no source prefix (e.g. live Reddit post ID)
        return _query_single_by_source_id(composite_id, source=None)

    source, source_id = composite_id.split('_', 1)
    # Map abbreviated source names (e.g. live NoBroker cache uses "nb_<id>")
    source = _SOURCE_ALIAS.get(source, source)
    return _query_single_by_source_id(source_id, source=source)


def get_listing_counts():
    conn, is_pg = _get_conn()
    try:
        cur = conn.cursor()
        if is_pg:
            cur.execute("""
                SELECT source,
                       COUNT(*) FILTER (WHERE status = 'active')  AS active_count,
                       COUNT(*) FILTER (WHERE status = 'stale')   AS stale_count,
                       COUNT(*) FILTER (WHERE status = 'expired') AS expired_count,
                       COUNT(*)                                    AS total_count,
                       EXTRACT(EPOCH FROM MIN(last_seen_at) FILTER (WHERE status = 'active'))::FLOAT AS oldest,
                       EXTRACT(EPOCH FROM MAX(last_seen_at) FILTER (WHERE status = 'active'))::FLOAT AS newest
                FROM listings
                GROUP BY source
            """)
        else:
            cur.execute("""
                SELECT source, COUNT(*) as cnt,
                       MIN(fetched_at) as oldest, MAX(fetched_at) as newest
                FROM listings WHERE expires_at > ?
                GROUP BY source
            """, (time.time(),))

        rows = cur.fetchall()
        result = {}
        for row in rows:
            if is_pg:
                src, active_cnt, stale_cnt, expired_cnt, total_cnt, oldest, newest = row
                result[src] = {
                    "count": active_cnt,
                    "stale_count": stale_cnt,
                    "expired_count": expired_cnt,
                    "total_count": total_cnt,
                    "oldest_fetched_at": oldest,
                    "newest_fetched_at": newest,
                    "oldest_age_minutes": round((time.time() - oldest) / 60, 1) if oldest else None,
                    "newest_age_minutes": round((time.time() - newest) / 60, 1) if newest else None,
                }
            else:
                src, cnt, oldest, newest = row["source"], row["cnt"], row["oldest"], row["newest"]
                result[src] = {
                    "count": cnt,
                    "stale_count": 0,
                    "expired_count": 0,
                    "total_count": cnt,
                    "oldest_fetched_at": oldest,
                    "newest_fetched_at": newest,
                    "oldest_age_minutes": round((time.time() - oldest) / 60, 1) if oldest else None,
                    "newest_age_minutes": round((time.time() - newest) / 60, 1) if newest else None,
                }
        return result
    except Exception as e:
        logger.error("get_listing_counts failed: %s", e)
        return {}
    finally:
        _put_conn(conn)


def get_locality_counts():
    conn, is_pg = _get_conn()
    try:
        cur = conn.cursor()
        if is_pg:
            cur.execute("""
                SELECT locality, COUNT(*) as cnt
                FROM listings
                WHERE status = 'active' AND locality IS NOT NULL
                GROUP BY locality
                ORDER BY cnt DESC
            """)
        else:
            cur.execute("""
                SELECT locality, COUNT(*) as cnt
                FROM listings
                WHERE expires_at > ? AND locality IS NOT NULL
                GROUP BY locality ORDER BY cnt DESC
            """, (time.time(),))

        rows = cur.fetchall()
        if is_pg:
            return {row[0]: row[1] for row in rows}
        return {row["locality"]: row["cnt"] for row in rows}
    except Exception as e:
        logger.error("get_locality_counts failed: %s", e)
        return {}
    finally:
        _put_conn(conn)


def purge_old_listings(max_age_hours=72):
    """No-op for Postgres — lifecycle managed by ingestion pipeline."""
    if _use_postgres():
        return 0

    conn, _ = _get_conn()
    try:
        cur = conn.cursor()
        cutoff = time.time() - (max_age_hours * 3600)
        cur.execute("DELETE FROM listings WHERE fetched_at < ?", (cutoff,))
        deleted = cur.rowcount
        conn.commit()
        if deleted:
            logger.info("Purged %d listings older than %dh", deleted, max_age_hours)
        return deleted
    except Exception as e:
        logger.error("purge_old_listings failed: %s", e)
        conn.rollback()
        return 0
    finally:
        conn.close()


def total_listing_count():
    conn, is_pg = _get_conn()
    try:
        cur = conn.cursor()
        if is_pg:
            cur.execute("""
                SELECT
                    COUNT(*) FILTER (WHERE status = 'active')  AS active_count,
                    COUNT(*)                                    AS total_count
                FROM listings
            """)
            row = cur.fetchone()
            active = row[0] if row else 0
            total = row[1] if row else 0
            return {"active": active, "total": total}
        else:
            cur.execute("SELECT COUNT(*) FROM listings WHERE expires_at > ?", (time.time(),))
            row = cur.fetchone()
            cnt = row[0] if row else 0
            return {"active": cnt, "total": cnt}
    except Exception as e:
        logger.error("total_listing_count failed: %s", e)
        return {"active": 0, "total": 0}
    finally:
        _put_conn(conn)
