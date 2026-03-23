-- ============================================================================
-- NestIQ — Saved listings with status tracking
-- Run via Supabase SQL Editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS saved_listings (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL,
    listing_id  TEXT        NOT NULL,   -- listings.id (stored as text for flexibility)
    status      TEXT        NOT NULL DEFAULT 'interested',
    -- allowed: 'interested' | 'contacted' | 'visited' | 'rejected'
    notes       TEXT,
    listing_snapshot JSONB,             -- snapshot of the listing at save time
    saved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT saved_listings_user_listing UNIQUE (user_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_listings_user
    ON saved_listings (user_id, saved_at DESC);

ALTER TABLE saved_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY saved_listings_select ON saved_listings
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY saved_listings_insert ON saved_listings
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY saved_listings_update ON saved_listings
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY saved_listings_delete ON saved_listings
    FOR DELETE USING (auth.uid() = user_id);
