"""
SQLite Replica Query Helpers
============================

Centralized read queries against the local SQLite replica.
Each function opens and closes its own connection. Exceptions propagate
to the caller so the endpoint's try/except can trigger Supabase fallback.
"""

from typing import Optional

from local_replica import get_connection


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


def get_rent_overview() -> list[dict]:
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
