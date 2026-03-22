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

logger = logging.getLogger(__name__)

_DATABASE_URL = os.environ.get("DATABASE_URL", "")
_SQLITE_PATH = os.path.join(os.path.dirname(__file__), "listings.db")


def _use_postgres():
    return bool(_DATABASE_URL)


def _get_conn():
    if _use_postgres():
        import psycopg2
        url = _DATABASE_URL
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        conn = psycopg2.connect(url)
        return conn, True
    else:
        conn = sqlite3.connect(_SQLITE_PATH)
        conn.row_factory = sqlite3.Row
        return conn, False


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
    limit=50,
    include_expired=False,
    since_utc=None,
):
    conn, is_pg = _get_conn()

    if not is_pg:
        return _query_listings_sqlite(
            conn, localities, sources, bhk, budget, limit, include_expired, since_utc
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

        if since_utc is not None:
            conditions.append("EXTRACT(EPOCH FROM posted_at) > %s")
            params.append(since_utc)

        where = " AND ".join(conditions) if conditions else "1=1"
        sql = f"""
            SELECT raw_payload FROM listings
            WHERE {where}
            ORDER BY posted_at DESC NULLS LAST
            LIMIT %s
        """
        params.append(limit)

        cur = conn.cursor()
        cur.execute(sql, params)
        rows = cur.fetchall()

        results = []
        for row in rows:
            d = _row_to_dict(row[0])
            if d:
                results.append(d)
        return results

    except Exception as e:
        logger.error("query_listings failed: %s", e)
        return []
    finally:
        conn.close()


def _query_listings_sqlite(conn, localities, sources, bhk, budget, limit, include_expired, since_utc):
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


def get_listing_counts():
    conn, is_pg = _get_conn()
    try:
        cur = conn.cursor()
        if is_pg:
            cur.execute("""
                SELECT source,
                       COUNT(*) as cnt,
                       EXTRACT(EPOCH FROM MIN(last_seen_at))::FLOAT as oldest,
                       EXTRACT(EPOCH FROM MAX(last_seen_at))::FLOAT as newest
                FROM listings
                WHERE status = 'active'
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
                src, cnt, oldest, newest = row
            else:
                src, cnt, oldest, newest = row["source"], row["cnt"], row["oldest"], row["newest"]
            result[src] = {
                "count": cnt,
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
        conn.close()


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
        conn.close()


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
            cur.execute("SELECT COUNT(*) FROM listings WHERE status = 'active'")
        else:
            cur.execute("SELECT COUNT(*) FROM listings WHERE expires_at > ?", (time.time(),))
        row = cur.fetchone()
        return row[0] if row else 0
    except Exception as e:
        logger.error("total_listing_count failed: %s", e)
        return 0
    finally:
        conn.close()
