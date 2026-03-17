"""
Persistent listing storage (SQLite locally, Postgres on Railway).

All sources (Reddit, Telegram, NoBroker) write normalized listings here.
The /api/search endpoint reads from this table for fast responses.
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


# ─────────────────────────────────────────────
# Schema
# ─────────────────────────────────────────────

_CREATE_SQLITE = """
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
);
CREATE INDEX IF NOT EXISTS idx_listings_source   ON listings(source);
CREATE INDEX IF NOT EXISTS idx_listings_locality ON listings(locality);
CREATE INDEX IF NOT EXISTS idx_listings_expires  ON listings(expires_at);
"""

_CREATE_PG = """
CREATE TABLE IF NOT EXISTS listings (
    id            TEXT PRIMARY KEY,
    source        TEXT NOT NULL,
    locality      TEXT,
    title         TEXT,
    body          TEXT,
    raw_json      TEXT,
    price         INTEGER,
    bhk           TEXT,
    created_utc   DOUBLE PRECISION,
    fetched_at    DOUBLE PRECISION NOT NULL,
    expires_at    DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listings_source   ON listings(source);
CREATE INDEX IF NOT EXISTS idx_listings_locality ON listings(locality);
CREATE INDEX IF NOT EXISTS idx_listings_expires  ON listings(expires_at);
"""


def init_listings_table():
    """Create the listings table if it doesn't exist."""
    conn, is_pg = _get_conn()
    try:
        cur = conn.cursor()
        sql = _CREATE_PG if is_pg else _CREATE_SQLITE
        for statement in sql.strip().split(";"):
            statement = statement.strip()
            if statement:
                cur.execute(statement)
        conn.commit()
        logger.info("listings table initialized (%s)", "postgres" if is_pg else "sqlite")
    except Exception as e:
        logger.error("Failed to init listings table: %s", e)
        conn.rollback()
        raise
    finally:
        conn.close()


# ─────────────────────────────────────────────
# Write operations
# ─────────────────────────────────────────────

def upsert_listing(listing: dict, ttl_seconds: int = 10800):
    """
    Insert or update a single listing.
    ttl_seconds defaults to 3 hours (10800s).
    """
    upsert_listings_batch([listing], ttl_seconds)


def upsert_listings_batch(listings: list, ttl_seconds: int = 10800):
    """
    Bulk insert/update listings.
    Each listing dict must have at least: id, source, title.
    """
    if not listings:
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

            if is_pg:
                cur.execute("""
                    INSERT INTO listings (id, source, locality, title, body, raw_json,
                                          price, bhk, created_utc, fetched_at, expires_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (id) DO UPDATE SET
                        locality   = EXCLUDED.locality,
                        title      = EXCLUDED.title,
                        body       = EXCLUDED.body,
                        raw_json   = EXCLUDED.raw_json,
                        price      = EXCLUDED.price,
                        bhk        = EXCLUDED.bhk,
                        fetched_at = EXCLUDED.fetched_at,
                        expires_at = EXCLUDED.expires_at
                """, row)
            else:
                cur.execute("""
                    INSERT OR REPLACE INTO listings
                        (id, source, locality, title, body, raw_json,
                         price, bhk, created_utc, fetched_at, expires_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)
                """, row)

        conn.commit()
        logger.info("Upserted %d listings (source=%s)",
                     len(listings), listings[0].get("source", "?"))
    except Exception as e:
        logger.error("upsert_listings_batch failed: %s", e)
        conn.rollback()
        raise
    finally:
        conn.close()


def _extract_price_int(item):
    """Pull an integer price from various formats listings use."""
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


# ─────────────────────────────────────────────
# Read operations
# ─────────────────────────────────────────────

def query_listings(
    localities=None,
    sources=None,
    bhk=None,
    budget=None,
    limit=50,
    include_expired=False,
):
    """
    Query listings from the DB.
    Returns list of full listing dicts (deserialized from raw_json).
    """
    conn, is_pg = _get_conn()
    ph = "%s" if is_pg else "?"

    try:
        conditions = []
        params = []

        if not include_expired:
            conditions.append(f"expires_at > {ph}")
            params.append(time.time())

        if sources:
            placeholders = ",".join([ph] * len(sources))
            conditions.append(f"source IN ({placeholders})")
            params.extend(sources)

        if localities:
            placeholders = ",".join([ph] * len(localities))
            conditions.append(f"LOWER(locality) IN ({placeholders})")
            params.extend([loc.lower() for loc in localities])

        if bhk and bhk != "any":
            conditions.append(
                f"LOWER(REPLACE(bhk, ' ', '')) LIKE {ph}"
            )
            params.append(f"%{bhk.lower().replace(' ', '')}%")

        if budget:
            try:
                budget_val = int(budget)
                conditions.append(f"(price IS NULL OR price <= {ph})")
                params.append(budget_val)
            except ValueError:
                pass

        where = " AND ".join(conditions) if conditions else "1=1"
        sql = f"""
            SELECT raw_json FROM listings
            WHERE {where}
            ORDER BY created_utc DESC
            LIMIT {ph}
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
        logger.error("query_listings failed: %s", e)
        return []
    finally:
        conn.close()


def get_listing_counts():
    """Return {source: {count, oldest_fetched_at, newest_fetched_at}} for status."""
    conn, is_pg = _get_conn()
    ph = "%s" if is_pg else "?"
    try:
        cur = conn.cursor()
        cur.execute(f"""
            SELECT source,
                   COUNT(*) as cnt,
                   MIN(fetched_at) as oldest,
                   MAX(fetched_at) as newest
            FROM listings
            WHERE expires_at > {ph}
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
    """Return {locality: count} for non-expired listings."""
    conn, is_pg = _get_conn()
    ph = "%s" if is_pg else "?"
    try:
        cur = conn.cursor()
        cur.execute(f"""
            SELECT locality, COUNT(*) as cnt
            FROM listings
            WHERE expires_at > {ph} AND locality IS NOT NULL
            GROUP BY locality
            ORDER BY cnt DESC
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
    """Delete listings older than max_age_hours."""
    conn, is_pg = _get_conn()
    ph = "%s" if is_pg else "?"
    try:
        cur = conn.cursor()
        cutoff = time.time() - (max_age_hours * 3600)
        cur.execute(f"DELETE FROM listings WHERE fetched_at < {ph}", (cutoff,))
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
    """Quick count of all non-expired listings."""
    conn, is_pg = _get_conn()
    ph = "%s" if is_pg else "?"
    try:
        cur = conn.cursor()
        cur.execute(f"SELECT COUNT(*) FROM listings WHERE expires_at > {ph}",
                    (time.time(),))
        row = cur.fetchone()
        return row[0] if row else 0
    except Exception as e:
        logger.error("total_listing_count failed: %s", e)
        return 0
    finally:
        conn.close()
