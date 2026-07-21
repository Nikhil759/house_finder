-- ============================================================================
-- Societies — first-class directory of gated communities / apartment
-- complexes, launching with Gurgaon.
--
-- Unlike the legacy `society_images` cache (never tracked in migrations —
-- created ad hoc in Supabase), this table is designed to be populated
-- top-down: a society can exist here before any listing references it.
-- `society_images` and `listings.society_name` / `listings.society_place_id`
-- are left untouched — this is purely additive.
-- ============================================================================

-- ── 1. Societies (reference + editorial entity) ─────────────────────────────

CREATE TABLE IF NOT EXISTS societies (
    id              BIGSERIAL PRIMARY KEY,

    -- Identity
    city            TEXT NOT NULL DEFAULT 'gurgaon',
    name            TEXT NOT NULL,
    slug            TEXT,

    -- Location (free text — Gurgaon addressing is sector-based, not tied to
    -- the Bangalore-only `localities` reference table)
    locality        TEXT,
    developer       TEXT,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,

    -- Editorial content
    description     TEXT,
    amenities       TEXT[] DEFAULT '{}',
    image_urls      TEXT[] DEFAULT '{}',

    -- External reference (Google Places, once enriched)
    place_id        TEXT,

    -- Provenance
    source          TEXT NOT NULL DEFAULT 'manual_seed',
    source_url      TEXT,

    -- Cached counter — refreshed by a transform/backfill job, not authoritative;
    -- always safe to recompute via COUNT(*) FROM listings WHERE society_id = id
    listing_count   INTEGER NOT NULL DEFAULT 0,

    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (city, name)
);

CREATE INDEX IF NOT EXISTS idx_societies_city     ON societies (city);
CREATE INDEX IF NOT EXISTS idx_societies_locality ON societies (locality);
CREATE INDEX IF NOT EXISTS idx_societies_active   ON societies (city, is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_societies_place_id ON societies (place_id) WHERE place_id IS NOT NULL;


-- ── 2. Real FK from listings → societies ─────────────────────────────────────
-- Replaces the fuzzy name-matched `society_place_id` hack for any listing
-- that gets linked going forward. `society_name` / `society_place_id` stay
-- as-is; they remain the matching key the linking script reads from.

ALTER TABLE listings
    ADD COLUMN IF NOT EXISTS society_id BIGINT REFERENCES societies(id);

CREATE INDEX IF NOT EXISTS idx_listings_society_id ON listings (society_id) WHERE society_id IS NOT NULL;
