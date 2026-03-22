-- ============================================================================
-- NestIQ — Initial schema for Supabase Postgres
-- Run once via Supabase SQL Editor or psql.
-- ============================================================================

-- ── 1. Localities (reference table) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS localities (
    id          SERIAL PRIMARY KEY,
    name        TEXT UNIQUE NOT NULL,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    radius_km   DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    aliases     TEXT[] DEFAULT '{}',
    also_include TEXT[] DEFAULT '{}',
    zone        TEXT,
    is_active   BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_localities_name ON localities (name);


-- ── 2. Listings (core table — all sources, never deleted) ───────────────────

CREATE TABLE IF NOT EXISTS listings (
    id                  BIGSERIAL PRIMARY KEY,

    -- Identity
    source              TEXT NOT NULL,
    source_id           TEXT NOT NULL,
    source_url          TEXT,
    source_group        TEXT,

    -- Lifecycle
    status              TEXT NOT NULL DEFAULT 'active',
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    marked_stale_at     TIMESTAMPTZ,
    consecutive_misses  INTEGER NOT NULL DEFAULT 0,

    -- Core listing
    title               TEXT,
    body                TEXT,
    bhk                 TEXT,
    property_type       TEXT,
    furnishing          TEXT,

    -- Pricing (always integer ₹)
    rent                INTEGER,
    deposit             INTEGER,
    maintenance         INTEGER,

    -- Location
    locality            TEXT,
    address             TEXT,
    latitude            DOUBLE PRECISION,
    longitude           DOUBLE PRECISION,
    maps_url            TEXT,

    -- Property details
    area_sqft           INTEGER,
    floor_info          TEXT,
    amenities           TEXT[] DEFAULT '{}',
    lease_type          TEXT,

    -- Contact
    contact_phone       TEXT,
    contact_name        TEXT,
    is_broker           BOOLEAN DEFAULT FALSE,
    no_brokerage        BOOLEAN DEFAULT FALSE,

    -- Flags
    is_flatmate         BOOLEAN DEFAULT FALSE,
    is_sponsored        BOOLEAN DEFAULT FALSE,

    -- Media
    thumbnail_url       TEXT,

    -- Timestamps
    posted_at           TIMESTAMPTZ,
    scraped_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Scoring
    quality_score       INTEGER DEFAULT 0,

    -- Duplicate detection
    duplicate_group_id  BIGINT,

    -- Raw data (original API response for reprocessing & ML)
    raw_payload         JSONB,

    -- Dedup constraint
    UNIQUE (source, source_id)
);

-- Query indexes
CREATE INDEX IF NOT EXISTS idx_listings_status        ON listings (status);
CREATE INDEX IF NOT EXISTS idx_listings_source        ON listings (source);
CREATE INDEX IF NOT EXISTS idx_listings_locality      ON listings (locality);
CREATE INDEX IF NOT EXISTS idx_listings_bhk           ON listings (bhk);
CREATE INDEX IF NOT EXISTS idx_listings_rent          ON listings (rent) WHERE rent IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listings_posted_at     ON listings (posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_last_seen     ON listings (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_quality       ON listings (quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_listings_duplicate     ON listings (duplicate_group_id) WHERE duplicate_group_id IS NOT NULL;

-- Composite index for the main search query pattern
CREATE INDEX IF NOT EXISTS idx_listings_active_search ON listings (status, locality, bhk, rent)
    WHERE status = 'active';

-- For the stale-marking batch update
CREATE INDEX IF NOT EXISTS idx_listings_stale_check   ON listings (source, status, last_seen_at)
    WHERE status = 'active';


-- ── 3. Listing price history ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS listing_price_history (
    id          BIGSERIAL PRIMARY KEY,
    listing_id  BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    rent        INTEGER,
    deposit     INTEGER,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_hist_listing
    ON listing_price_history (listing_id, recorded_at DESC);


-- ── 4. Ingestion runs (pipeline observability) ─────────────────────────────

CREATE TABLE IF NOT EXISTS ingestion_runs (
    id              BIGSERIAL PRIMARY KEY,
    source          TEXT NOT NULL,
    run_id          TEXT,

    started_at      TIMESTAMPTZ NOT NULL,
    finished_at     TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'running',

    -- Counters
    total_fetched   INTEGER DEFAULT 0,
    total_new       INTEGER DEFAULT 0,
    total_updated   INTEGER DEFAULT 0,
    total_stale     INTEGER DEFAULT 0,
    total_errors    INTEGER DEFAULT 0,

    -- Breakdown
    locality_counts JSONB,

    -- Error info
    error_message   TEXT,

    -- Duration
    duration_ms     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_runs_source_time
    ON ingestion_runs (source, started_at DESC);


-- ── 5. Alerts ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alerts (
    id              BIGSERIAL PRIMARY KEY,
    email           TEXT NOT NULL,
    bhk             TEXT DEFAULT 'any',
    locality        TEXT DEFAULT '',
    budget_max      INTEGER,
    keywords        TEXT DEFAULT '',
    label           TEXT DEFAULT '',
    sources         TEXT[] DEFAULT '{}',
    last_sent_ids   JSONB DEFAULT '[]'::JSONB,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_triggered  TIMESTAMPTZ
);


-- ── 6. User profiles ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_profiles (
    id                      BIGSERIAL PRIMARY KEY,
    supabase_uid            UUID UNIQUE NOT NULL,
    email                   TEXT,
    preferred_localities    TEXT[],
    preferred_bhk           TEXT[],
    budget_min              INTEGER,
    budget_max              INTEGER,
    preferred_furnishing    TEXT[],
    move_in_date            DATE,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);


-- ── 7. User–listing interactions (for ML) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS user_listing_interactions (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT REFERENCES user_profiles(id) ON DELETE CASCADE,
    listing_id  BIGINT REFERENCES listings(id) ON DELETE CASCADE,
    action      TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interactions_user
    ON user_listing_interactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_listing
    ON user_listing_interactions (listing_id);
