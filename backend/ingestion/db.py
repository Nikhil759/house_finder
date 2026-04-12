"""
Shared database writer for all ingestion scripts.

Connects to Supabase Postgres and provides:
  - upsert_listings()  — batch insert/update StandardListing objects
  - mark_stale()       — flag listings not seen in recent cycles
  - record_run_start() / record_run_end() — observability
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Optional

import psycopg2
import psycopg2.extras

from ingestion.models import StandardListing

logger = logging.getLogger(__name__)

BATCH_SIZE = 50


def get_connection():
    """Return a psycopg2 connection to Supabase Postgres."""
    url = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("SUPABASE_DB_URL or DATABASE_URL must be set")
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return psycopg2.connect(url)


# ─────────────────────────────────────────────
# Upsert listings
# ─────────────────────────────────────────────

class UpsertStats:
    """Counters returned by upsert_listings."""
    def __init__(self):
        self.total_new = 0
        self.total_updated = 0
        self.total_errors = 0
        self.price_changes = 0


_UPSERT_COLUMNS = [
    "source", "source_id", "source_url", "source_group",
    "title", "body", "bhk", "property_type", "furnishing",
    "rent", "deposit", "maintenance",
    "locality", "address", "latitude", "longitude", "maps_url",
    "area_sqft", "floor_info", "amenities", "lease_type",
    "contact_phone", "contact_name", "is_broker", "no_brokerage",
    "is_flatmate", "is_sponsored", "thumbnail_url",
    "posted_at", "scraped_at", "quality_score", "raw_payload",
    "society_name", "image_urls",
]

_UPDATE_ON_CONFLICT = [
    "source_url", "source_group",
    "title", "body", "bhk", "property_type", "furnishing",
    "rent", "deposit", "maintenance",
    "locality", "address", "latitude", "longitude", "maps_url",
    "area_sqft", "floor_info", "amenities", "lease_type",
    "contact_phone", "contact_name", "is_broker", "no_brokerage",
    "is_flatmate", "is_sponsored", "thumbnail_url",
    "posted_at", "scraped_at", "quality_score", "raw_payload",
    "society_name", "image_urls",
]


def _listing_to_row(listing: StandardListing, now: datetime) -> tuple:
    """Convert a StandardListing to a tuple matching _UPSERT_COLUMNS."""
    raw_json = json.dumps(listing.raw_payload, default=str) if listing.raw_payload else None
    amenities = listing.amenities if listing.amenities else []
    image_urls = listing.image_urls if listing.image_urls else []
    return (
        listing.source, listing.source_id, listing.source_url, listing.source_group,
        listing.title, listing.body, listing.bhk, listing.property_type,
        listing.furnishing,
        listing.rent, listing.deposit, listing.maintenance,
        listing.locality, listing.address, listing.latitude, listing.longitude,
        listing.maps_url,
        listing.area_sqft, listing.floor_info, amenities, listing.lease_type,
        listing.contact_phone, listing.contact_name, listing.is_broker, listing.no_brokerage,
        listing.is_flatmate, listing.is_sponsored, listing.thumbnail_url,
        listing.posted_at, now, listing.quality_score,
        raw_json,
        listing.society_name, image_urls,
    )


def upsert_listings(listings: list[StandardListing]) -> UpsertStats:
    """
    Batch upsert listings using INSERT ... ON CONFLICT.
    Detects price changes via a CTE that captures old values.
    """
    if not listings:
        return UpsertStats()

    stats = UpsertStats()
    now = datetime.now(timezone.utc)
    conn = get_connection()

    cols = ", ".join(_UPSERT_COLUMNS)
    placeholders = ", ".join(["%s"] * len(_UPSERT_COLUMNS))
    update_set = ", ".join(
        f"{c} = EXCLUDED.{c}" for c in _UPDATE_ON_CONFLICT
    )

    upsert_sql = f"""
        INSERT INTO listings (
            {cols},
            status, first_seen_at, last_seen_at, consecutive_misses, marked_stale_at
        )
        VALUES (
            {placeholders},
            'active', NOW(), NOW(), 0, NULL
        )
        ON CONFLICT (source, source_id) DO UPDATE SET
            {update_set},
            status = 'active',
            last_seen_at = NOW(),
            consecutive_misses = 0,
            marked_stale_at = NULL
        RETURNING id, source_id,
                  (xmax = 0) AS is_new,
                  rent,
                  deposit
    """

    try:
        cur = conn.cursor()

        old_prices: dict[str, tuple] = {}
        source = listings[0].source if listings else ""
        source_ids = [l.source_id for l in listings]
        if source_ids:
            cur.execute(
                "SELECT source_id, rent, deposit FROM listings WHERE source = %s AND source_id = ANY(%s)",
                (source, source_ids),
            )
            for row in cur.fetchall():
                old_prices[row[0]] = (row[1], row[2])

        for i in range(0, len(listings), BATCH_SIZE):
            batch = listings[i:i + BATCH_SIZE]
            rows = [_listing_to_row(l, now) for l in batch]

            results = []
            for row in rows:
                try:
                    cur.execute(upsert_sql, row)
                    results.append(cur.fetchone())
                except Exception as e:
                    logger.error("Failed to upsert %s: %s", row[1], e)
                    stats.total_errors += 1
                    conn.rollback()
                    cur = conn.cursor()
                    old_prices = {}

            for res in results:
                if res is None:
                    continue
                listing_id, source_id, is_new, new_rent, new_deposit = res
                if is_new:
                    stats.total_new += 1
                else:
                    stats.total_updated += 1
                    old = old_prices.get(source_id)
                    if old:
                        old_rent, old_deposit = old
                        if (new_rent and old_rent and new_rent != old_rent) or \
                           (new_deposit and old_deposit and new_deposit != old_deposit):
                            try:
                                cur.execute(
                                    "INSERT INTO listing_price_history (listing_id, rent, deposit) VALUES (%s, %s, %s)",
                                    (listing_id, new_rent, new_deposit),
                                )
                                stats.price_changes += 1
                            except Exception as e:
                                logger.error("Failed to record price change for %s: %s", listing_id, e)

            conn.commit()

    except Exception as e:
        logger.error("upsert_listings batch failed: %s", e)
        conn.rollback()
        raise
    finally:
        conn.close()

    logger.info(
        "Upserted %d listings (new=%d, updated=%d, errors=%d, price_changes=%d)",
        len(listings), stats.total_new, stats.total_updated,
        stats.total_errors, stats.price_changes,
    )
    return stats


# ─────────────────────────────────────────────
# Stale marking
# ─────────────────────────────────────────────

def mark_stale(source: str, run_started_at: datetime) -> int:
    """
    After a full scrape cycle for a source, mark listings that weren't
    seen in this cycle. Returns the number of listings marked stale.
    """
    conn = get_connection()
    stale_count = 0
    try:
        cur = conn.cursor()

        cur.execute("""
            UPDATE listings
            SET consecutive_misses = consecutive_misses + 1
            WHERE source = %s
              AND status = 'active'
              AND last_seen_at < %s
        """, (source, run_started_at))

        cur.execute("""
            UPDATE listings
            SET status = 'stale', marked_stale_at = NOW()
            WHERE source = %s
              AND status = 'active'
              AND consecutive_misses >= 2
            RETURNING id
        """, (source,))
        stale_count = cur.rowcount

        cur.execute("""
            UPDATE listings
            SET status = 'expired'
            WHERE source = %s
              AND status = 'stale'
              AND last_seen_at < NOW() - INTERVAL '7 days'
        """, (source,))

        conn.commit()
        logger.info("Stale marking for %s: %d stale, %d expired", source, stale_count, cur.rowcount)
    except Exception as e:
        logger.error("mark_stale failed for %s: %s", source, e)
        conn.rollback()
    finally:
        conn.close()
    return stale_count


# ─────────────────────────────────────────────
# Ingestion run tracking
# ─────────────────────────────────────────────

def record_run_start(source: str, run_id: Optional[str] = None) -> int:
    """Insert a new ingestion_runs row. Returns the row id."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO ingestion_runs (source, run_id, started_at, status)
            VALUES (%s, %s, NOW(), 'running')
            RETURNING id
        """, (source, run_id))
        row_id = cur.fetchone()[0]
        conn.commit()
        return row_id
    finally:
        conn.close()


def record_run_end(
    row_id: int,
    status: str,
    stats: Optional[UpsertStats] = None,
    total_fetched: int = 0,
    total_stale: int = 0,
    locality_counts: Optional[dict] = None,
    error_message: Optional[str] = None,
    started_at: Optional[datetime] = None,
):
    """Update the ingestion_runs row with final metrics."""
    conn = get_connection()
    try:
        duration_ms = None
        if started_at:
            duration_ms = int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000)

        cur = conn.cursor()
        cur.execute("""
            UPDATE ingestion_runs SET
                finished_at     = NOW(),
                status          = %s,
                total_fetched   = %s,
                total_new       = %s,
                total_updated   = %s,
                total_stale     = %s,
                total_errors    = %s,
                locality_counts = %s,
                error_message   = %s,
                duration_ms     = %s
            WHERE id = %s
        """, (
            status,
            total_fetched,
            stats.total_new if stats else 0,
            stats.total_updated if stats else 0,
            total_stale,
            stats.total_errors if stats else 0,
            json.dumps(locality_counts) if locality_counts else None,
            error_message,
            duration_ms,
            row_id,
        ))
        conn.commit()
    except Exception as e:
        logger.error("record_run_end failed: %s", e)
        conn.rollback()
    finally:
        conn.close()
