"""
Pipeline health check — detects stale ingestion sources.

Queries ingestion_runs for sources whose last successful run is older
than 2× their expected interval. Logs warnings and records results
in transform_runs.

Run via Railway Cron every hour, or manually:
  python -m transforms.check_health
"""

from __future__ import annotations

import logging
from transforms.db import get_connection, record_transform_start, record_transform_end
from datetime import datetime, timezone

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("check_health")

EXPECTED_INTERVALS_HOURS = {
    "nobroker": 3,
    "housing": 3,
    "telegram": 3,
    "reddit": 6,
    "reddit_discussions": 6,
    "news": 6,
}

ALERT_MULTIPLIER = 2


def check_stale_sources() -> list[dict]:
    """Return list of sources whose last success is overdue."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT source,
                   MAX(finished_at) AS last_success,
                   EXTRACT(EPOCH FROM NOW() - MAX(finished_at)) / 3600 AS hours_since
            FROM ingestion_runs
            WHERE status IN ('success', 'partial')
            GROUP BY source
        """)
        rows = cur.fetchall()
    finally:
        conn.close()

    stale = []
    for source, last_success, hours_since in rows:
        expected = EXPECTED_INTERVALS_HOURS.get(source, 6)
        threshold = expected * ALERT_MULTIPLIER
        if hours_since and hours_since > threshold:
            stale.append({
                "source": source,
                "last_success": str(last_success),
                "hours_since": round(hours_since, 1),
                "expected_hours": expected,
                "threshold_hours": threshold,
            })

    return stale


def check_transform_health() -> dict:
    """Check for elevated Gemini fallback rates in recent transform runs."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT job_name,
                   gemini_calls,
                   gemini_fallback_count,
                   started_at
            FROM transform_runs
            WHERE gemini_calls > 0
              AND started_at >= NOW() - INTERVAL '24 hours'
            ORDER BY started_at DESC
            LIMIT 50
        """)
        rows = cur.fetchall()
    finally:
        conn.close()

    high_fallback_jobs = []
    for job_name, calls, fallbacks, started_at in rows:
        if calls > 0 and fallbacks / calls > 0.1:
            high_fallback_jobs.append({
                "job_name": job_name,
                "gemini_calls": calls,
                "gemini_fallback_count": fallbacks,
                "fallback_rate": round(fallbacks / calls, 3),
                "started_at": str(started_at),
            })

    return {"high_fallback_jobs": high_fallback_jobs}


def main():
    started_at = datetime.now(timezone.utc)
    run_id = record_transform_start("health_check")

    stale_sources = check_stale_sources()
    transform_health = check_transform_health()

    if stale_sources:
        for s in stale_sources:
            logger.warning(
                "STALE SOURCE: %s — last success %.1fh ago (expected every %dh)",
                s["source"], s["hours_since"], s["expected_hours"],
            )
    else:
        logger.info("All ingestion sources are on schedule")

    if transform_health["high_fallback_jobs"]:
        for j in transform_health["high_fallback_jobs"]:
            logger.warning(
                "HIGH GEMINI FALLBACK: %s — %.1f%% fallback rate (%d/%d calls)",
                j["job_name"], j["fallback_rate"] * 100,
                j["gemini_fallback_count"], j["gemini_calls"],
            )
    else:
        logger.info("No elevated Gemini fallback rates in last 24h")

    record_transform_end(
        run_id,
        status="warning" if stale_sources or transform_health["high_fallback_jobs"] else "success",
        started_at=started_at,
        metadata={
            "stale_sources": stale_sources,
            "transform_health": transform_health,
        },
    )


if __name__ == "__main__":
    main()
