"""
Transform run tracking — mirrors ingestion/db.py's record_run_start/end
for transform jobs.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

import psycopg2

logger = logging.getLogger(__name__)


def get_connection():
    url = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("SUPABASE_DB_URL or DATABASE_URL must be set")
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return psycopg2.connect(url)


def record_transform_start(
    job_name: str,
    source: Optional[str] = None,
) -> int:
    """Insert a new transform_runs row. Returns the row id."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO transform_runs (job_name, source, started_at, status)
            VALUES (%s, %s, NOW(), 'running')
            RETURNING id
        """, (job_name, source))
        row_id = cur.fetchone()[0]
        conn.commit()
        return row_id
    finally:
        conn.close()


def record_transform_end(
    row_id: int,
    status: str,
    records_processed: int = 0,
    records_failed: int = 0,
    records_skipped: int = 0,
    gemini_calls: int = 0,
    gemini_fallback_count: int = 0,
    error_message: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
    started_at: Optional[datetime] = None,
):
    """Update the transform_runs row with final metrics."""
    conn = get_connection()
    try:
        duration_ms = None
        if started_at:
            duration_ms = int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000)

        cur = conn.cursor()
        cur.execute("""
            UPDATE transform_runs SET
                finished_at           = NOW(),
                status                = %s,
                duration_ms           = %s,
                records_processed     = %s,
                records_failed        = %s,
                records_skipped       = %s,
                gemini_calls          = %s,
                gemini_fallback_count = %s,
                error_message         = %s,
                metadata              = %s
            WHERE id = %s
        """, (
            status,
            duration_ms,
            records_processed,
            records_failed,
            records_skipped,
            gemini_calls,
            gemini_fallback_count,
            error_message,
            json.dumps(metadata) if metadata else None,
            row_id,
        ))
        conn.commit()
    except Exception as e:
        logger.error("record_transform_end failed: %s", e)
        conn.rollback()
    finally:
        conn.close()
