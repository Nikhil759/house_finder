-- ============================================================================
-- Phase 2: Create feed_curated table for the Pulse transform pipeline
-- ============================================================================

CREATE TABLE IF NOT EXISTS feed_curated (
    feed_id             BIGINT PRIMARY KEY REFERENCES locality_feed(id),

    -- Editorial curation
    featured            BOOLEAN DEFAULT FALSE,
    editor_rank         INTEGER,
    editor_note         TEXT,

    -- Trend detection
    is_trending         BOOLEAN DEFAULT FALSE,
    trending_score      FLOAT,

    -- Gemini tracking
    gemini_tagged       BOOLEAN DEFAULT FALSE,
    gemini_fallback     BOOLEAN DEFAULT FALSE,

    -- Timestamps
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feed_curated_featured
    ON feed_curated (featured, editor_rank ASC)
    WHERE featured = TRUE;

CREATE INDEX IF NOT EXISTS idx_feed_curated_trending
    ON feed_curated (is_trending, trending_score DESC)
    WHERE is_trending = TRUE;

CREATE INDEX IF NOT EXISTS idx_feed_curated_gemini_fallback
    ON feed_curated (gemini_fallback)
    WHERE gemini_fallback = TRUE;

-- RLS
ALTER TABLE feed_curated ENABLE ROW LEVEL SECURITY;

CREATE POLICY feed_curated_select ON feed_curated
    FOR SELECT USING (true);
