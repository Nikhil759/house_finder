-- ============================================================================
-- NestIQ — Locality feed table for news articles and community content.
-- Run via Supabase SQL Editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS locality_feed (
    id          BIGSERIAL PRIMARY KEY,

    -- Identity (unique per source + article)
    source      TEXT NOT NULL,          -- e.g. 'news', 'reddit', 'telegram'
    source_id   TEXT NOT NULL,          -- MD5 of URL for news; post ID for others

    -- Content
    locality    TEXT NOT NULL,
    title       TEXT,                   -- max 500 chars at insert time
    body        TEXT,                   -- max 1000 chars at insert time
    url         TEXT,
    author      TEXT,                   -- publication name or username

    -- Signals
    engagement  INTEGER NOT NULL DEFAULT 0,
    topic       TEXT,                   -- NULL until Gemini tagging is added
    sentiment   TEXT,                   -- NULL until Gemini tagging is added

    -- Timestamps
    posted_at   TIMESTAMPTZ,            -- original publish time from the source
    scraped_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT locality_feed_source_id UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_locality_feed_locality
    ON locality_feed (locality, scraped_at DESC);

CREATE INDEX IF NOT EXISTS idx_locality_feed_source
    ON locality_feed (source, scraped_at DESC);

CREATE INDEX IF NOT EXISTS idx_locality_feed_posted_at
    ON locality_feed (posted_at DESC);

-- Public read access (same pattern as locality_stats_cache)
ALTER TABLE locality_feed ENABLE ROW LEVEL SECURITY;

CREATE POLICY locality_feed_select ON locality_feed
    FOR SELECT USING (true);
