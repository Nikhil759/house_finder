"""
Sync Job: Supabase Postgres → Local SQLite Replica
===================================================

Full-refresh sync: for each table, DELETE all rows in the replica then
INSERT all rows from Supabase. Each table is synced in its own transaction
so a failure on one table does not block the others.

Usage:
    python -m sync.sync_to_sqlite --dry-run --limit 100 --tables listings,localities
"""

import argparse
import datetime
import json
import logging
import os
import sys
import time
import uuid
from typing import Optional
from decimal import Decimal

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from ingestion.db import get_connection as get_supabase_connection  # noqa: E402
from local_replica import get_connection as get_replica_connection  # noqa: E402
from local_replica import REPLICA_TABLES  # noqa: E402

logger = logging.getLogger(__name__)

SYNC_ORDER = [
    "localities",
    "feed_topics",
    "listings",
    "listings_curated",
    "locality_feed",
    "feed_curated",
    "locality_stats_cache",
    "deposit_stats_cache",
    "locality_images",
    "society_images",
]


def to_sqlite_value(val):
    """
    Convert a Python value returned by psycopg2 to a SQLite-compatible value.

    Handles: None, bool, datetime, date, Decimal, dict/list (jsonb/arrays), passthrough.
    """
    if val is None:
        return None
    if isinstance(val, bool):
        return 1 if val else 0
    if isinstance(val, (datetime.datetime, datetime.date)):
        return val.isoformat()
    if isinstance(val, Decimal):
        return float(val)
    if isinstance(val, (dict, list)):
        return json.dumps(val, default=str)
    return val


def sync_table(
    table_name: str,
    supabase_conn,
    replica_conn,
    limit: int = None,
    dry_run: bool = False,
) -> dict:
    """
    Full-refresh sync for a single table: DELETE + INSERT.

    Returns a stats dict with table name, row counts, duration, and status.
    """
    start = time.time()
    rows_read = 0
    rows_written = 0

    try:
        pg_cur = supabase_conn.cursor()
        query = f"SELECT * FROM {table_name}"
        if limit:
            query += f" LIMIT {limit}"
        pg_cur.execute(query)

        columns = [desc[0] for desc in pg_cur.description]
        rows = pg_cur.fetchall()
        rows_read = len(rows)
        pg_cur.close()

        if dry_run:
            duration_ms = round((time.time() - start) * 1000, 1)
            logger.info(
                "DRY RUN: %s — %d rows would be synced",
                table_name,
                rows_read,
                extra={
                    "table": table_name,
                    "rows_read": rows_read,
                    "columns": columns,
                    "dry_run": True,
                },
            )
            return {
                "table": table_name,
                "rows_read": rows_read,
                "rows_written": 0,
                "duration_ms": duration_ms,
                "status": "ok",
                "dry_run": True,
            }

        placeholders = ", ".join(["?"] * len(columns))
        col_list = ", ".join(columns)
        insert_sql = f"INSERT INTO {table_name} ({col_list}) VALUES ({placeholders})"

        converted_rows = [
            tuple(to_sqlite_value(val) for val in row) for row in rows
        ]

        replica_conn.execute("BEGIN")
        replica_conn.execute(f"DELETE FROM {table_name}")
        replica_conn.executemany(insert_sql, converted_rows)
        replica_conn.execute("COMMIT")
        rows_written = len(converted_rows)

        duration_ms = round((time.time() - start) * 1000, 1)
        logger.info(
            "Synced %s: %d rows in %.1fms",
            table_name,
            rows_written,
            duration_ms,
            extra={
                "table": table_name,
                "rows_read": rows_read,
                "rows_written": rows_written,
                "duration_ms": duration_ms,
            },
        )
        return {
            "table": table_name,
            "rows_read": rows_read,
            "rows_written": rows_written,
            "duration_ms": duration_ms,
            "status": "ok",
        }

    except Exception as e:
        duration_ms = round((time.time() - start) * 1000, 1)
        try:
            replica_conn.execute("ROLLBACK")
        except Exception:
            pass
        logger.error(
            "Sync failed for %s: %s",
            table_name,
            e,
            exc_info=True,
            extra={"table": table_name, "duration_ms": duration_ms},
        )
        return {
            "table": table_name,
            "rows_read": rows_read,
            "rows_written": 0,
            "duration_ms": duration_ms,
            "status": "error",
            "error": str(e),
        }


def _record_sync_start(sync_run_id: str, trigger_reason: str, dry_run: bool) -> Optional[int]:
    """Insert a sync_runs row with status='running'. Returns row id or None on failure."""
    try:
        from ingestion.db import get_connection as get_pg_conn
        conn = get_pg_conn()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO sync_runs (sync_run_id, started_at, status, trigger_reason, dry_run)
            VALUES (%s, NOW(), 'running', %s, %s)
            RETURNING id
        """, (sync_run_id, trigger_reason, dry_run))
        row_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        return row_id
    except Exception as e:
        logger.warning("sync_runs INSERT failed (non-fatal): %s", e)
        return None


def _record_sync_end(row_id: int, status: str, total_duration_ms, total_rows_read,
                     total_rows_written, success_count, error_count,
                     per_table_stats, error_message=None):
    """Update sync_runs row with final results. Non-fatal on failure."""
    if row_id is None:
        return
    try:
        import json as _json
        from ingestion.db import get_connection as get_pg_conn
        conn = get_pg_conn()
        cur = conn.cursor()
        cur.execute("""
            UPDATE sync_runs SET
                finished_at = NOW(),
                status = %s,
                total_duration_ms = %s,
                total_rows_read = %s,
                total_rows_written = %s,
                success_count = %s,
                error_count = %s,
                per_table_stats = %s,
                error_message = %s
            WHERE id = %s
        """, (
            status,
            int(total_duration_ms) if total_duration_ms else None,
            total_rows_read,
            total_rows_written,
            success_count,
            error_count,
            _json.dumps(per_table_stats, default=str) if per_table_stats else None,
            error_message,
            row_id,
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning("sync_runs UPDATE failed (non-fatal): %s", e)


def sync_all(
    limit: int = None,
    dry_run: bool = False,
    tables: list = None,
    trigger_reason: str = "manual",
) -> dict:
    """
    Orchestrate full-refresh sync across all (or a subset of) replica tables.

    Returns aggregate stats including per-table results.
    """
    sync_run_id = str(uuid.uuid4())
    overall_start = time.time()

    if tables:
        for t in tables:
            if t not in REPLICA_TABLES:
                raise ValueError(
                    f"Unknown table '{t}'. Valid tables: {REPLICA_TABLES}"
                )
        table_order = [t for t in SYNC_ORDER if t in tables]
        for t in tables:
            if t not in table_order:
                table_order.append(t)
    else:
        table_order = SYNC_ORDER

    # Record sync start in Supabase (non-fatal)
    db_row_id = _record_sync_start(sync_run_id, trigger_reason, dry_run)

    logger.info(
        "Sync starting",
        extra={
            "sync_run_id": sync_run_id,
            "tables": table_order,
            "dry_run": dry_run,
            "limit": limit,
            "trigger_reason": trigger_reason,
        },
    )

    results = []
    supabase_conn = None
    replica_conn = None
    error_message = None

    try:
        supabase_conn = get_supabase_connection()
        replica_conn = get_replica_connection()

        for table_name in table_order:
            try:
                result = sync_table(
                    table_name,
                    supabase_conn,
                    replica_conn,
                    limit=limit,
                    dry_run=dry_run,
                )
            except Exception as e:
                result = {
                    "table": table_name,
                    "rows_read": 0,
                    "rows_written": 0,
                    "duration_ms": 0,
                    "status": "error",
                    "error": str(e),
                }
            results.append(result)

    except Exception as e:
        error_message = str(e)
        logger.error("sync_all crashed: %s", e, exc_info=True)
    finally:
        if supabase_conn:
            try:
                supabase_conn.close()
            except Exception:
                pass
        if replica_conn:
            try:
                replica_conn.close()
            except Exception:
                pass

    total_duration_ms = round((time.time() - overall_start) * 1000, 1)
    success_count = sum(1 for r in results if r["status"] == "ok")
    error_count = sum(1 for r in results if r["status"] == "error")
    total_rows_read = sum(r.get("rows_read", 0) for r in results)
    total_rows_written = sum(r.get("rows_written", 0) for r in results)

    summary = {
        "success_count": success_count,
        "error_count": error_count,
        "total_rows_read": total_rows_read,
        "total_rows_written": total_rows_written,
    }

    # Determine final status
    if error_message:
        final_status = "error"
    elif error_count > 0 and success_count > 0:
        final_status = "partial"
    elif error_count > 0:
        final_status = "error"
    else:
        final_status = "success"

    # Record sync end in Supabase (non-fatal)
    _record_sync_end(
        db_row_id, final_status, total_duration_ms,
        total_rows_read, total_rows_written,
        success_count, error_count, results, error_message,
    )

    logger.info(
        "Sync complete",
        extra={
            "sync_run_id": sync_run_id,
            "total_duration_ms": total_duration_ms,
            "summary": summary,
            "status": final_status,
        },
    )

    return {
        "sync_run_id": sync_run_id,
        "total_duration_ms": total_duration_ms,
        "tables": results,
        "summary": summary,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Sync Supabase Postgres tables to local SQLite replica"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Log what would be synced without writing to SQLite",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit rows fetched per table (for testing)",
    )
    parser.add_argument(
        "--tables",
        type=str,
        default=None,
        help="Comma-separated list of tables to sync (default: all)",
    )
    args = parser.parse_args()

    tables = None
    if args.tables:
        tables = [t.strip() for t in args.tables.split(",")]

    result = sync_all(limit=args.limit, dry_run=args.dry_run, tables=tables)
    print(json.dumps(result, indent=2, default=str))

    if result["summary"]["error_count"] > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
