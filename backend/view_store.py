"""
Listing view store — anonymous view tracking for listing detail pages.

Views are a SOFT, INFORMATIONAL signal: they never affect listing visibility,
ranking, or scoring. This module owns:
  * Logging a view (with 24h server-side dedupe per device)
  * Per-listing total_views read paths (single + batch) used to embed counts
    into `/api/listing` and `/api/search` responses

Mirrors flag_store.py exactly — same dual-DB pattern (Postgres prod /
SQLite local-dev), same import-time-safe connection sharing with
listing_store, and the same UUID validation helpers.

Design notes:
  * Read path NEVER scans the raw `listing_views` table — it reads from the
    `listing_view_stats` precomputed cache, which `log_view` keeps fresh by
    incrementing inline on every NEW (non-deduped) insert.
  * 24h dedupe is enforced server-side; refreshing the page can never inflate
    the count.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import time
import uuid
from typing import Optional

logger = logging.getLogger(__name__)


# Same window the spec calls out: "same device viewing the same listing
# within a 24h window counts as one view, not multiple."
DEDUPE_WINDOW_SECONDS = 86400


# ── DB connection (mirrors flag_store) ───────────────────────────────────────
_DATABASE_URL = os.environ.get("DATABASE_URL", "")
_SQLITE_PATH  = os.path.join(os.path.dirname(__file__), "alerts.db")


def _use_postgres() -> bool:
    return bool(os.environ.get("DATABASE_URL", "") or _DATABASE_URL)


def _get_conn():
    if _use_postgres():
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


def _ensure_sqlite_tables(conn):
    """Local-dev convenience: create both view tables on first use."""
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS listing_views (
            id          TEXT PRIMARY KEY,
            listing_id  TEXT NOT NULL,
            device_id   TEXT NOT NULL,
            user_id     TEXT,
            ip_address  TEXT,
            viewed_at   REAL NOT NULL
        )
    """)
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_listing_views_dedupe "
        "ON listing_views (listing_id, device_id, viewed_at DESC)"
    )
    cur.execute("""
        CREATE TABLE IF NOT EXISTS listing_view_stats (
            listing_id    TEXT PRIMARY KEY,
            total_views   INTEGER NOT NULL DEFAULT 0,
            refreshed_at  REAL    NOT NULL
        )
    """)
    conn.commit()


# ── Validation ───────────────────────────────────────────────────────────────
def is_valid_uuid(value: str | None) -> bool:
    if not value:
        return False
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, TypeError):
        return False


# ── Mutations ────────────────────────────────────────────────────────────────
def log_view(
    listing_id: str,
    device_id: str,
    *,
    user_id: str | None = None,
    ip_address: str | None = None,
) -> tuple[bool, bool]:
    """
    Record a view, with 24h dedupe per (listing_id, device_id).

    Returns (recorded, deduped):
      * (True,  False) — a new row was inserted and listing_view_stats bumped
      * (True,  True ) — within the 24h window; no DB write, treated as success
      * (False, False) — validation failed (bad device_id) or DB error

    The (True, True) case is intentional: from the caller's perspective the
    request "succeeded" — the user did open the page — we just chose not to
    re-count it. The boolean lets the API surface `deduped: true` to the
    client so PostHog can split fresh vs deduped events.
    """
    if not listing_id or not is_valid_uuid(device_id):
        return False, False

    new_id = str(uuid.uuid4())

    conn, is_pg = _get_conn()
    try:
        if not is_pg:
            _ensure_sqlite_tables(conn)
        cur = conn.cursor()

        # ── Dedupe check: any view from this device on this listing within
        # the rolling 24h window?
        if is_pg:
            cur.execute(
                "SELECT 1 FROM listing_views "
                "WHERE listing_id = %s AND device_id = %s "
                "  AND viewed_at > NOW() - INTERVAL '24 hours' "
                "LIMIT 1",
                (listing_id, device_id),
            )
        else:
            cutoff = time.time() - DEDUPE_WINDOW_SECONDS
            cur.execute(
                "SELECT 1 FROM listing_views "
                "WHERE listing_id = ? AND device_id = ? AND viewed_at > ? "
                "LIMIT 1",
                (listing_id, device_id, cutoff),
            )
        if cur.fetchone():
            # Inside the dedupe window — treat as success but don't count.
            return True, True

        # ── Insert raw view row + bump aggregate cache in same transaction.
        if is_pg:
            cur.execute(
                """
                INSERT INTO listing_views
                    (id, listing_id, device_id, user_id, ip_address)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (new_id, listing_id, device_id, user_id, ip_address),
            )
            cur.execute(
                """
                INSERT INTO listing_view_stats (listing_id, total_views, refreshed_at)
                VALUES (%s, 1, NOW())
                ON CONFLICT (listing_id) DO UPDATE SET
                    total_views  = listing_view_stats.total_views + 1,
                    refreshed_at = NOW()
                """,
                (listing_id,),
            )
        else:
            now = time.time()
            cur.execute(
                "INSERT INTO listing_views "
                "(id, listing_id, device_id, user_id, ip_address, viewed_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (new_id, listing_id, device_id, user_id, ip_address, now),
            )
            cur.execute(
                "INSERT INTO listing_view_stats (listing_id, total_views, refreshed_at) "
                "VALUES (?, 1, ?) "
                "ON CONFLICT(listing_id) DO UPDATE SET "
                "    total_views  = total_views + 1, "
                "    refreshed_at = excluded.refreshed_at",
                (listing_id, now),
            )
        conn.commit()
        return True, False

    except Exception as e:
        logger.error("log_view failed: %s", e)
        try:
            conn.rollback()
        except Exception:
            pass
        return False, False
    finally:
        _put_conn(conn, is_pg)


# ── Read paths ───────────────────────────────────────────────────────────────
def get_view_summaries(listing_ids: list[str]) -> dict[str, int]:
    """
    Single batch query: { listing_id: total_views } for every listing_id supplied.
    Listings with no recorded views are omitted (caller defaults to 0).

    This is the workhorse for embedding view counts into search results without
    an N+1 query — caller fetches listings, collects IDs, calls this once, and
    zips the results back in (mirrors get_flag_summaries).
    """
    if not listing_ids:
        return {}

    conn, is_pg = _get_conn()
    try:
        if not is_pg:
            _ensure_sqlite_tables(conn)
        cur = conn.cursor()

        if is_pg:
            cur.execute(
                "SELECT listing_id, total_views FROM listing_view_stats "
                "WHERE listing_id = ANY(%s)",
                (list(listing_ids),),
            )
        else:
            placeholders = ",".join("?" * len(listing_ids))
            cur.execute(
                f"SELECT listing_id, total_views FROM listing_view_stats "
                f"WHERE listing_id IN ({placeholders})",
                list(listing_ids),
            )

        return {row[0]: int(row[1] or 0) for row in cur.fetchall()}
    except Exception as e:
        logger.error("get_view_summaries failed: %s", e)
        return {}
    finally:
        _put_conn(conn, is_pg)


def get_view_summary(listing_id: str) -> int:
    """Convenience wrapper for a single listing — returns total_views (0 if none)."""
    return get_view_summaries([listing_id]).get(listing_id, 0)
