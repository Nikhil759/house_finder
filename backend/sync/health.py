"""
Sync health monitoring — queries the sync_runs table in Supabase
to provide a health summary for the /api/admin/replica-status endpoint.
"""

import json
import logging
import time

logger = logging.getLogger(__name__)


def get_sync_health() -> dict:
    """
    Query sync_runs table in Supabase, return health summary dict.
    Returns a safe fallback on any failure (don't crash the endpoint).
    """
    try:
        from ingestion.db import get_connection
        conn = get_connection()
        cur = conn.cursor()

        # Last sync
        cur.execute("""
            SELECT sync_run_id, started_at, finished_at, status,
                   total_duration_ms, trigger_reason
            FROM sync_runs
            ORDER BY started_at DESC
            LIMIT 1
        """)
        last_row = cur.fetchone()

        # Counts in last 24h
        cur.execute("""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successes,
                SUM(CASE WHEN status IN ('error', 'partial') THEN 1 ELSE 0 END) AS failures
            FROM sync_runs
            WHERE started_at >= NOW() - INTERVAL '24 hours'
        """)
        counts_row = cur.fetchone()

        conn.close()

        if not last_row:
            return {"health_assessment": "unknown"}

        sync_run_id, started_at, finished_at, status, duration_ms, trigger_reason = last_row
        total_24h = counts_row[0] or 0
        successes_24h = counts_row[1] or 0
        failures_24h = counts_row[2] or 0

        # Calculate minutes ago
        minutes_ago = None
        if started_at:
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            if hasattr(started_at, 'timestamp'):
                minutes_ago = round((now.timestamp() - started_at.timestamp()) / 60, 1)

        # Health assessment
        hours_ago = (minutes_ago / 60) if minutes_ago else None
        failure_rate = (failures_24h / total_24h) if total_24h > 0 else 0

        if hours_ago is None or total_24h == 0:
            health = "unknown"
        elif hours_ago > 6:
            health = "stale"
        elif status != "success" or failure_rate > 0.5:
            health = "failing"
        else:
            health = "healthy"

        return {
            "last_sync_at": started_at.isoformat() if hasattr(started_at, 'isoformat') else str(started_at),
            "last_sync_minutes_ago": minutes_ago,
            "last_sync_status": status,
            "last_sync_duration_ms": duration_ms,
            "last_sync_trigger": trigger_reason,
            "syncs_last_24h": total_24h,
            "successful_syncs_last_24h": successes_24h,
            "failed_syncs_last_24h": failures_24h,
            "health_assessment": health,
        }

    except Exception as e:
        logger.warning("get_sync_health failed: %s", e)
        return {"health_assessment": "unknown", "error": str(e)}


def get_recent_sync_runs(limit=10) -> list:
    """
    Fetch the last N sync runs from Supabase for display in the UI.
    Returns a list of dicts, or empty list on failure.
    """
    try:
        from ingestion.db import get_connection
        conn = get_connection()
        cur = conn.cursor()

        cur.execute("""
            SELECT sync_run_id, started_at, finished_at, status,
                   trigger_reason, dry_run, total_duration_ms,
                   total_rows_read, total_rows_written,
                   success_count, error_count, error_message,
                   per_table_stats
            FROM sync_runs
            ORDER BY started_at DESC
            LIMIT %s
        """, (limit,))

        rows = cur.fetchall()
        conn.close()

        results = []
        for row in rows:
            (sync_run_id, started_at, finished_at, status, trigger_reason,
             dry_run, duration_ms, rows_read, rows_written,
             success_count, error_count, error_message, per_table_stats) = row

            results.append({
                "sync_run_id": str(sync_run_id),
                "started_at": started_at.isoformat() if hasattr(started_at, 'isoformat') else str(started_at),
                "finished_at": finished_at.isoformat() if finished_at and hasattr(finished_at, 'isoformat') else None,
                "status": status,
                "trigger_reason": trigger_reason,
                "dry_run": dry_run,
                "duration_ms": duration_ms,
                "rows_read": rows_read,
                "rows_written": rows_written,
                "success_count": success_count,
                "error_count": error_count,
                "error_message": error_message,
                "tables": per_table_stats if isinstance(per_table_stats, list) else [],
            })

        return results

    except Exception as e:
        logger.warning("get_recent_sync_runs failed: %s", e)
        return []
