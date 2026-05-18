"""
Local SQLite Read Replica for NestIQ
=====================================

This module manages a local SQLite database that mirrors a subset of tables from
the primary Supabase Postgres database. Its purpose is latency reduction and
resilience for public-facing read endpoints — Postgres remains the source of truth.

Architecture:
  - Supabase Postgres (Mumbai) is the primary write database
  - This SQLite file is a read-only mirror kept in sync (Phase 2)
  - Flask read endpoints will be migrated to query SQLite (Phase 3)

Runtime dependency:
  - Requires a writable volume mounted at /data on Railway (house_finder service)
  - The path is overridable via REPLICA_DB_PATH env var for local dev

IMPORTANT: This module is entirely separate from the existing sqlite3 usage in
flag_store.py, listing_store.py, and view_store.py, which serve unrelated
local-dev purposes. Do not conflate them.
"""

import logging
import os
import sqlite3

logger = logging.getLogger(__name__)

REPLICA_DB_PATH = os.environ.get("REPLICA_DB_PATH", "/data/nestiq_replica.db")

REPLICA_TABLES = [
    "listings",
    "localities",
    "locality_feed",
    "listings_curated",
    "feed_topics",
    "feed_curated",
    "locality_stats_cache",
    "deposit_stats_cache",
    "locality_images",
    "society_images",
]

# ── Schema definitions ────────────────────────────────────────────────────────
# Each entry is a list of SQL statements (CREATE TABLE + CREATE INDEX) for one table.

SCHEMA = {
    "listings": [
        """
        CREATE TABLE IF NOT EXISTS listings (
            id                  INTEGER PRIMARY KEY,
            source              TEXT NOT NULL,
            source_id           TEXT NOT NULL,
            source_url          TEXT,
            source_group        TEXT,
            status              TEXT NOT NULL DEFAULT 'active',
            first_seen_at       TEXT,
            last_seen_at        TEXT,
            marked_stale_at     TEXT,
            consecutive_misses  INTEGER NOT NULL DEFAULT 0,
            title               TEXT,
            body                TEXT,
            bhk                 TEXT,
            property_type       TEXT,
            furnishing          TEXT,
            rent                INTEGER,
            deposit             INTEGER,
            maintenance         INTEGER,
            locality            TEXT,
            address             TEXT,
            latitude            REAL,
            longitude           REAL,
            maps_url            TEXT,
            area_sqft           INTEGER,
            floor_info          TEXT,
            amenities           TEXT DEFAULT '[]',
            lease_type          TEXT,
            contact_phone       TEXT,
            contact_name        TEXT,
            is_broker           INTEGER DEFAULT 0,
            no_brokerage        INTEGER DEFAULT 0,
            is_flatmate         INTEGER DEFAULT 0,
            is_sponsored        INTEGER DEFAULT 0,
            thumbnail_url       TEXT,
            posted_at           TEXT,
            scraped_at          TEXT,
            quality_score       INTEGER DEFAULT 0,
            duplicate_group_id  INTEGER,
            raw_payload         TEXT,
            society_name        TEXT,
            society_place_id    TEXT,
            image_urls          TEXT DEFAULT '[]',
            images              TEXT,
            listing_type        TEXT NOT NULL DEFAULT 'full_house',
            type_attributes     TEXT DEFAULT '{}',
            UNIQUE (source, source_id)
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_r_listings_status ON listings (status)",
        "CREATE INDEX IF NOT EXISTS idx_r_listings_source ON listings (source)",
        "CREATE INDEX IF NOT EXISTS idx_r_listings_locality ON listings (locality)",
        "CREATE INDEX IF NOT EXISTS idx_r_listings_bhk ON listings (bhk)",
        "CREATE INDEX IF NOT EXISTS idx_r_listings_rent ON listings (rent)",
        "CREATE INDEX IF NOT EXISTS idx_r_listings_posted_at ON listings (posted_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_r_listings_last_seen ON listings (last_seen_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_r_listings_quality ON listings (quality_score DESC)",
        "CREATE INDEX IF NOT EXISTS idx_r_listings_listing_type ON listings (listing_type)",
        "CREATE INDEX IF NOT EXISTS idx_r_listings_active_search ON listings (status, locality, bhk, rent)",
    ],

    "localities": [
        """
        CREATE TABLE IF NOT EXISTS localities (
            id          INTEGER PRIMARY KEY,
            name        TEXT UNIQUE NOT NULL,
            latitude    REAL NOT NULL,
            longitude   REAL NOT NULL,
            radius_km   REAL NOT NULL DEFAULT 2.0,
            aliases     TEXT DEFAULT '[]',
            also_include TEXT DEFAULT '[]',
            zone        TEXT,
            is_active   INTEGER DEFAULT 1
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_r_localities_name ON localities (name)",
    ],

    "locality_feed": [
        """
        CREATE TABLE IF NOT EXISTS locality_feed (
            id              INTEGER PRIMARY KEY,
            source          TEXT NOT NULL,
            source_id       TEXT NOT NULL,
            locality        TEXT,
            title           TEXT,
            body            TEXT,
            url             TEXT,
            author          TEXT,
            engagement      INTEGER NOT NULL DEFAULT 0,
            topic           TEXT,
            sentiment       TEXT,
            posted_at       TEXT,
            scraped_at      TEXT NOT NULL,
            category        TEXT,
            canonical_topic TEXT,
            sentiment_score REAL,
            relevance_score REAL,
            detected_localities TEXT DEFAULT '[]',
            UNIQUE (source, source_id)
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_r_lfeed_locality_scraped ON locality_feed (locality, scraped_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_r_lfeed_source_scraped ON locality_feed (source, scraped_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_r_lfeed_posted_at ON locality_feed (posted_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_r_lfeed_category ON locality_feed (category)",
        "CREATE INDEX IF NOT EXISTS idx_r_lfeed_canonical_topic ON locality_feed (canonical_topic)",
    ],

    "listings_curated": [
        """
        CREATE TABLE IF NOT EXISTS listings_curated (
            listing_id          INTEGER PRIMARY KEY,
            quality_score       INTEGER DEFAULT 0,
            detail_score        INTEGER DEFAULT 0,
            price_comp_score    INTEGER DEFAULT 0,
            locality_sent_score INTEGER DEFAULT 0,
            freshness_score     INTEGER DEFAULT 0,
            price_anomaly       INTEGER DEFAULT 0,
            is_per_room         INTEGER DEFAULT 0,
            rent_type           TEXT DEFAULT 'unknown',
            extracted_bhk       TEXT,
            extracted_rent      INTEGER,
            extracted_locality  TEXT,
            gemini_tagged       INTEGER DEFAULT 0,
            gemini_fallback     INTEGER DEFAULT 0,
            duplicate_group_id  INTEGER,
            is_listing          INTEGER,
            created_at          TEXT,
            updated_at          TEXT
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_r_curated_quality ON listings_curated (quality_score DESC)",
        "CREATE INDEX IF NOT EXISTS idx_r_curated_gemini_fallback ON listings_curated (gemini_fallback)",
    ],

    "feed_topics": [
        """
        CREATE TABLE IF NOT EXISTS feed_topics (
            slug        TEXT PRIMARY KEY,
            label       TEXT NOT NULL,
            description TEXT,
            created_at  TEXT
        )
        """,
    ],

    "feed_curated": [
        """
        CREATE TABLE IF NOT EXISTS feed_curated (
            feed_id         INTEGER PRIMARY KEY,
            featured        INTEGER DEFAULT 0,
            editor_rank     INTEGER,
            editor_note     TEXT,
            is_trending     INTEGER DEFAULT 0,
            trending_score  REAL,
            gemini_tagged   INTEGER DEFAULT 0,
            gemini_fallback INTEGER DEFAULT 0,
            created_at      TEXT,
            updated_at      TEXT
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_r_fcurated_featured ON feed_curated (featured, editor_rank)",
        "CREATE INDEX IF NOT EXISTS idx_r_fcurated_trending ON feed_curated (is_trending, trending_score DESC)",
    ],

    "locality_stats_cache": [
        """
        CREATE TABLE IF NOT EXISTS locality_stats_cache (
            locality              TEXT NOT NULL,
            bhk                   TEXT NOT NULL,
            median_rent           INTEGER,
            p25_rent              INTEGER,
            p75_rent              INTEGER,
            listing_count         INTEGER,
            updated_at            TEXT,
            rent_trend_pct        REAL,
            median_price_per_sqft REAL,
            PRIMARY KEY (locality, bhk)
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_r_lstats_bhk_rent ON locality_stats_cache (bhk, median_rent DESC)",
    ],

    "deposit_stats_cache": [
        """
        CREATE TABLE IF NOT EXISTS deposit_stats_cache (
            bhk             TEXT PRIMARY KEY,
            median_deposit  INTEGER,
            avg_multiplier  REAL,
            updated_at      TEXT
        )
        """,
    ],

    "locality_images": [
        """
        CREATE TABLE IF NOT EXISTS locality_images (
            locality        TEXT PRIMARY KEY,
            place_id        TEXT,
            image_url       TEXT,
            photo_reference TEXT,
            attribution     TEXT,
            fetched_at      TEXT
        )
        """,
    ],

    "society_images": [
        """
        CREATE TABLE IF NOT EXISTS society_images (
            place_id         TEXT PRIMARY KEY,
            society_name     TEXT,
            image_urls       TEXT DEFAULT '[]',
            google_name      TEXT,
            match_confidence REAL,
            listing_count    INTEGER,
            fetched_at       TEXT
        )
        """,
    ],
}


def get_connection() -> sqlite3.Connection:
    """
    Return a configured SQLite connection to the replica database.

    PRAGMAs applied:
      - journal_mode=WAL: allows concurrent readers while writing (critical for sync + serve)
      - synchronous=NORMAL: safe with WAL; reduces fsync calls for better write throughput
      - busy_timeout=5000: wait up to 5s if DB is locked instead of failing immediately
      - foreign_keys=ON: enforce referential integrity during sync inserts
    """
    conn = sqlite3.connect(REPLICA_DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def initialize_replica():
    """
    Create all replica tables and indexes if they don't exist.

    Idempotent — safe to call on every app startup. Uses CREATE TABLE IF NOT EXISTS
    and CREATE INDEX IF NOT EXISTS so repeated calls are no-ops.
    """
    os.makedirs(os.path.dirname(REPLICA_DB_PATH), exist_ok=True)
    conn = get_connection()
    try:
        for table_name, statements in SCHEMA.items():
            for sql in statements:
                conn.execute(sql)
        conn.commit()
        logger.info(
            "SQLite replica initialized",
            extra={"db_path": REPLICA_DB_PATH, "table_count": len(SCHEMA)},
        )
    finally:
        conn.close()


def health_check() -> dict:
    """
    Return replica status for the /api/admin/replica-status endpoint.

    Confirms the DB file is accessible, lists existing tables, and reports file size.
    """
    try:
        conn = get_connection()
        cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        tables = [row[0] for row in cursor.fetchall()]
        conn.close()

        db_size = 0
        if os.path.exists(REPLICA_DB_PATH):
            db_size = os.path.getsize(REPLICA_DB_PATH)

        return {
            "status": "ok",
            "tables": tables,
            "table_count": len(tables),
            "db_path": REPLICA_DB_PATH,
            "db_size_bytes": db_size,
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "db_path": REPLICA_DB_PATH,
        }
