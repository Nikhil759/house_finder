-- ============================================================================
-- NestIQ — Enhanced tagging: feed_topics table + new locality_feed columns.
-- Run via Supabase SQL Editor.
-- ============================================================================

-- ── 1. Canonical topics table (organic growth via tagger) ─────────────────

CREATE TABLE IF NOT EXISTS feed_topics (
    slug        TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO feed_topics (slug, label, description) VALUES
    ('water',   'Water & Utilities',  'Water supply, borewell, Cauvery, tanker, shortage, BWSSB'),
    ('infra',   'Infrastructure',     'Metro, roads, BBMP, construction, flyover, power cuts, electricity'),
    ('rent',    'Rent & Housing',     'Rent prices, deposit, landlord, lease, hike, brokerage, market trends'),
    ('commute', 'Commute & Traffic',  'Traffic, Uber, Ola, signal, travel time, congestion, public transit'),
    ('safety',  'Safety & Security',  'Theft, crime, police, security, harassment'),
    ('vibe',    'Vibe & Lifestyle',   'Restaurants, pubs, parks, walkability, nightlife, community, cleanliness')
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE feed_topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY feed_topics_select ON feed_topics FOR SELECT USING (true);

-- ── 2. New columns on locality_feed ───────────────────────────────────────

ALTER TABLE locality_feed ADD COLUMN IF NOT EXISTS category            TEXT;
ALTER TABLE locality_feed ADD COLUMN IF NOT EXISTS canonical_topic     TEXT;
ALTER TABLE locality_feed ADD COLUMN IF NOT EXISTS sentiment_score     FLOAT;
ALTER TABLE locality_feed ADD COLUMN IF NOT EXISTS relevance_score     FLOAT;
ALTER TABLE locality_feed ADD COLUMN IF NOT EXISTS detected_localities TEXT[];

-- Allow NULL locality for city-level news articles (assigned by Gemini later)
ALTER TABLE locality_feed ALTER COLUMN locality DROP NOT NULL;

-- ── 3. Indexes ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_locality_feed_category
    ON locality_feed (category);

CREATE INDEX IF NOT EXISTS idx_locality_feed_canonical_topic
    ON locality_feed (canonical_topic);

CREATE INDEX IF NOT EXISTS idx_locality_feed_detected_localities
    ON locality_feed USING GIN (detected_localities);

CREATE INDEX IF NOT EXISTS idx_locality_feed_untagged
    ON locality_feed (scraped_at DESC)
    WHERE category IS NULL;
