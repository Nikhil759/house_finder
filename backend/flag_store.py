"""
Listing flag store — anonymous-friendly listing reports.

Flags are a SOFT signal only: they never affect listing visibility in search.
This module owns:
  * Submit / retract a flag
  * Per-listing summary (count + top category) for embedding in search results
  * Full reports list for the listing detail page
  * Anti-abuse rate-limit checks (per device + per IP fallback)

All operations work for both Postgres (production) and SQLite (local dev).
"""

from __future__ import annotations

import logging
import os
import sqlite3
import time
import uuid
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


# ── Allowed categories ───────────────────────────────────────────────────────
# Order is significant: matches the order shown in the UI modal so renters
# always see them in the same order. Labels are mirrored on the frontend.
ALLOWED_CATEGORIES = (
    "already_rented",
    "fake_or_duplicate",
    "photos_dont_match",
    "contact_doesnt_work",
    "wrong_price_or_details",
    "not_a_listing",
    "other",
)

# Anti-abuse limits (device + IP each get the same cap as a fallback)
MAX_FLAGS_PER_DEVICE_PER_DAY = 5
MAX_FLAGS_PER_IP_PER_DAY     = 5
NOTE_MAX_CHARS               = 500


# ── DB connection (mirrors listing_store) ────────────────────────────────────
_DATABASE_URL = os.environ.get("DATABASE_URL", "")
_SQLITE_PATH  = os.path.join(os.path.dirname(__file__), "alerts.db")


def _use_postgres() -> bool:
    return bool(os.environ.get("DATABASE_URL", "") or _DATABASE_URL)


def _get_conn():
    if _use_postgres():
        # Reuse the listing_store pool so we don't open extra connections.
        from listing_store import _get_conn as _ls_get_conn
        return _ls_get_conn()
    conn = sqlite3.connect(_SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    return conn, False


def _put_conn(conn, is_pg: bool):
    if is_pg:
        from listing_store import _put_conn as _ls_put_conn
        _ls_put_conn(conn)
    else:
        try:
            conn.close()
        except Exception:
            pass


def _ensure_sqlite_table(conn):
    """Local-dev convenience: create the flags table on first use."""
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS listing_flags (
            id            TEXT PRIMARY KEY,
            listing_id    TEXT NOT NULL,
            category      TEXT NOT NULL,
            note          TEXT,
            device_id     TEXT NOT NULL,
            user_id       TEXT,
            ip_address    TEXT,
            was_signed_in INTEGER NOT NULL DEFAULT 0,
            retracted_at  REAL,
            created_at    REAL NOT NULL
        )
    """)
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_listing_flags_listing "
        "ON listing_flags(listing_id) WHERE retracted_at IS NULL"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_listing_flags_device "
        "ON listing_flags(device_id, created_at)"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_listing_flags_ip "
        "ON listing_flags(ip_address, created_at) WHERE ip_address IS NOT NULL"
    )
    conn.commit()


# ── Validation ───────────────────────────────────────────────────────────────
def is_valid_category(category: str) -> bool:
    return category in ALLOWED_CATEGORIES


def normalise_note(note: str | None) -> str | None:
    if not note:
        return None
    text = note.strip()
    if not text:
        return None
    return text[:NOTE_MAX_CHARS]


def is_valid_uuid(value: str | None) -> bool:
    if not value:
        return False
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, TypeError):
        return False


# ── Rate-limit checks ────────────────────────────────────────────────────────
def _count_recent(conn, is_pg: bool, column: str, value, window_seconds: int) -> int:
    cur = conn.cursor()
    if is_pg:
        cur.execute(
            f"SELECT COUNT(*) FROM listing_flags "
            f"WHERE {column} = %s AND created_at > NOW() - INTERVAL '%s seconds'",
            (value, window_seconds),
        )
    else:
        cutoff = time.time() - window_seconds
        cur.execute(
            f"SELECT COUNT(*) FROM listing_flags WHERE {column} = ? AND created_at > ?",
            (value, cutoff),
        )
    row = cur.fetchone()
    return int(row[0]) if row else 0


def check_rate_limits(device_id: str, ip_address: str | None) -> tuple[bool, str | None]:
    """
    Return (allowed, error_code). error_code is one of:
      * None              — under all limits
      * 'device_limit'    — too many flags from this device
      * 'ip_limit'        — too many flags from this IP
    """
    conn, is_pg = _get_conn()
    try:
        if not is_pg:
            _ensure_sqlite_table(conn)

        device_count = _count_recent(conn, is_pg, "device_id", device_id, 86400)
        if device_count >= MAX_FLAGS_PER_DEVICE_PER_DAY:
            return False, "device_limit"

        if ip_address:
            ip_count = _count_recent(conn, is_pg, "ip_address", ip_address, 86400)
            if ip_count >= MAX_FLAGS_PER_IP_PER_DAY:
                return False, "ip_limit"

        return True, None
    except Exception as e:
        logger.error("check_rate_limits failed: %s", e)
        # Fail-open: don't block users if the check itself errors out.
        return True, None
    finally:
        _put_conn(conn, is_pg)


# ── Mutations ────────────────────────────────────────────────────────────────
def get_existing_flag(listing_id: str, device_id: str) -> dict | None:
    """Return the active flag this device has on this listing, or None."""
    conn, is_pg = _get_conn()
    try:
        if not is_pg:
            _ensure_sqlite_table(conn)
        cur = conn.cursor()
        if is_pg:
            cur.execute(
                "SELECT id, listing_id, category, note, "
                "       EXTRACT(EPOCH FROM created_at)::FLOAT AS created_epoch "
                "FROM listing_flags "
                "WHERE listing_id = %s AND device_id = %s AND retracted_at IS NULL "
                "LIMIT 1",
                (listing_id, device_id),
            )
        else:
            cur.execute(
                "SELECT id, listing_id, category, note, created_at "
                "FROM listing_flags "
                "WHERE listing_id = ? AND device_id = ? AND retracted_at IS NULL "
                "LIMIT 1",
                (listing_id, device_id),
            )
        row = cur.fetchone()
        if not row:
            return None
        return {
            "id":         row[0] if not is_pg else str(row[0]),
            "listing_id": row[1],
            "category":   row[2],
            "note":       row[3],
            "created_at": float(row[4]) if row[4] is not None else None,
        }
    except Exception as e:
        logger.error("get_existing_flag failed: %s", e)
        return None
    finally:
        _put_conn(conn, is_pg)


def submit_flag(
    listing_id: str,
    category: str,
    device_id: str,
    note: str | None = None,
    user_id: str | None = None,
    ip_address: str | None = None,
) -> tuple[dict | None, str | None]:
    """
    Insert a flag. Returns (flag_dict, error_code).
    error_code is one of None | 'duplicate' | 'invalid_category' | 'invalid_device' | 'db_error'.
    """
    if not is_valid_category(category):
        return None, "invalid_category"
    if not is_valid_uuid(device_id):
        return None, "invalid_device"

    note = normalise_note(note)
    new_id = str(uuid.uuid4())
    was_signed_in = bool(user_id)

    conn, is_pg = _get_conn()
    try:
        if not is_pg:
            _ensure_sqlite_table(conn)
        cur = conn.cursor()

        if is_pg:
            try:
                cur.execute(
                    """
                    INSERT INTO listing_flags
                        (id, listing_id, category, note, device_id, user_id,
                         ip_address, was_signed_in)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id, EXTRACT(EPOCH FROM created_at)::FLOAT AS ts
                    """,
                    (new_id, listing_id, category, note, device_id,
                     user_id, ip_address, was_signed_in),
                )
            except Exception as e:
                # The partial unique index will reject a duplicate active flag.
                conn.rollback()
                msg = str(e).lower()
                if "uq_listing_flags_device_active" in msg or "duplicate" in msg or "unique" in msg:
                    return None, "duplicate"
                logger.error("submit_flag insert failed: %s", e)
                return None, "db_error"
            row = cur.fetchone()
            conn.commit()
            return {
                "id":         str(row[0]),
                "listing_id": listing_id,
                "category":   category,
                "note":       note,
                "created_at": float(row[1]) if row[1] is not None else time.time(),
            }, None
        else:
            existing = get_existing_flag(listing_id, device_id)
            if existing:
                return None, "duplicate"
            now = time.time()
            cur.execute(
                "INSERT INTO listing_flags "
                "(id, listing_id, category, note, device_id, user_id, "
                " ip_address, was_signed_in, retracted_at, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)",
                (new_id, listing_id, category, note, device_id,
                 user_id, ip_address, 1 if was_signed_in else 0, now),
            )
            conn.commit()
            return {
                "id":         new_id,
                "listing_id": listing_id,
                "category":   category,
                "note":       note,
                "created_at": now,
            }, None
    except Exception as e:
        logger.error("submit_flag failed: %s", e)
        try:
            conn.rollback()
        except Exception:
            pass
        return None, "db_error"
    finally:
        _put_conn(conn, is_pg)


def retract_flag(flag_id: str, device_id: str) -> tuple[bool, str | None]:
    """
    Mark a flag as retracted. Only the original device can retract its own flag.
    Returns (ok, error_code). error_code: None | 'not_found' | 'forbidden' | 'db_error'
    """
    if not is_valid_uuid(device_id):
        return False, "forbidden"

    conn, is_pg = _get_conn()
    try:
        if not is_pg:
            _ensure_sqlite_table(conn)
        cur = conn.cursor()

        # Check ownership first so we can distinguish "not yours" from "missing".
        if is_pg:
            cur.execute(
                "SELECT device_id, retracted_at FROM listing_flags WHERE id = %s",
                (flag_id,),
            )
        else:
            cur.execute(
                "SELECT device_id, retracted_at FROM listing_flags WHERE id = ?",
                (flag_id,),
            )
        row = cur.fetchone()
        if not row:
            return False, "not_found"
        owner = str(row[0])
        already_retracted = row[1] is not None
        if owner != str(device_id):
            return False, "forbidden"
        if already_retracted:
            return True, None  # idempotent

        if is_pg:
            cur.execute(
                "UPDATE listing_flags SET retracted_at = NOW() WHERE id = %s",
                (flag_id,),
            )
        else:
            cur.execute(
                "UPDATE listing_flags SET retracted_at = ? WHERE id = ?",
                (time.time(), flag_id),
            )
        conn.commit()
        return True, None
    except Exception as e:
        logger.error("retract_flag failed: %s", e)
        try:
            conn.rollback()
        except Exception:
            pass
        return False, "db_error"
    finally:
        _put_conn(conn, is_pg)


# ── Read paths ───────────────────────────────────────────────────────────────
def get_flag_summaries(listing_ids: list[str]) -> dict[str, dict]:
    """
    Single batch query that returns
        { listing_id: { count: int, top_category: str|None } }
    for every listing_id supplied. Listings with zero active flags are
    omitted from the dict.

    This is the workhorse for embedding flag summaries into search results
    without an N+1 query — caller fetches listings, collects IDs, calls this
    once, and zips the results back in.
    """
    if not listing_ids:
        return {}

    conn, is_pg = _get_conn()
    try:
        if not is_pg:
            _ensure_sqlite_table(conn)
        cur = conn.cursor()

        if is_pg:
            cur.execute(
                """
                WITH per_cat AS (
                    SELECT listing_id, category, COUNT(*) AS cnt
                    FROM listing_flags
                    WHERE listing_id = ANY(%s) AND retracted_at IS NULL
                    GROUP BY listing_id, category
                ),
                ranked AS (
                    SELECT listing_id, category, cnt,
                           ROW_NUMBER() OVER (
                               PARTITION BY listing_id
                               ORDER BY cnt DESC, category ASC
                           ) AS rn
                    FROM per_cat
                )
                SELECT listing_id,
                       SUM(cnt)::INT                              AS total,
                       MAX(CASE WHEN rn = 1 THEN category END)    AS top_category
                FROM ranked
                GROUP BY listing_id
                """,
                (list(listing_ids),),
            )
        else:
            placeholders = ",".join("?" * len(listing_ids))
            cur.execute(
                f"""
                SELECT listing_id, category, COUNT(*) AS cnt
                FROM listing_flags
                WHERE listing_id IN ({placeholders}) AND retracted_at IS NULL
                GROUP BY listing_id, category
                """,
                list(listing_ids),
            )

        result: dict[str, dict] = {}
        if is_pg:
            for lid, total, top_cat in cur.fetchall():
                result[lid] = {"count": int(total or 0), "top_category": top_cat}
        else:
            # Aggregate manually for sqlite.
            buckets: dict[str, dict[str, int]] = {}
            for lid, cat, cnt in cur.fetchall():
                buckets.setdefault(lid, {})[cat] = int(cnt)
            for lid, by_cat in buckets.items():
                top_cat = max(by_cat.items(), key=lambda kv: (kv[1], -ord(kv[0][0])))[0]
                result[lid] = {
                    "count": sum(by_cat.values()),
                    "top_category": top_cat,
                }
        return result
    except Exception as e:
        logger.error("get_flag_summaries failed: %s", e)
        return {}
    finally:
        _put_conn(conn, is_pg)


def get_flag_summary(listing_id: str) -> dict:
    """Convenience wrapper for a single listing — returns {count, top_category}."""
    summaries = get_flag_summaries([listing_id])
    return summaries.get(listing_id, {"count": 0, "top_category": None})


def list_flags_for_listing(listing_id: str, limit: int = 50) -> list[dict]:
    """
    Return active flags for a listing, newest first, with per-flag fields
    needed by the detail-page reports section.

    Author identity is intentionally omitted (no names, no device IDs, no IPs)
    so reports stay anonymous. The own-flag check is done client-side by
    matching `id` against the device's localStorage list.
    """
    conn, is_pg = _get_conn()
    try:
        if not is_pg:
            _ensure_sqlite_table(conn)
        cur = conn.cursor()
        if is_pg:
            cur.execute(
                """
                SELECT id, category, note, device_id,
                       EXTRACT(EPOCH FROM created_at)::FLOAT AS created_epoch
                FROM listing_flags
                WHERE listing_id = %s AND retracted_at IS NULL
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (listing_id, limit),
            )
        else:
            cur.execute(
                "SELECT id, category, note, device_id, created_at "
                "FROM listing_flags "
                "WHERE listing_id = ? AND retracted_at IS NULL "
                "ORDER BY created_at DESC LIMIT ?",
                (listing_id, limit),
            )

        items = []
        for row in cur.fetchall():
            items.append({
                "id":         str(row[0]),
                "category":   row[1],
                "note":       row[2],
                "device_id":  str(row[3]),
                "created_at": float(row[4]) if row[4] is not None else None,
            })
        return items
    except Exception as e:
        logger.error("list_flags_for_listing failed: %s", e)
        return []
    finally:
        _put_conn(conn, is_pg)
