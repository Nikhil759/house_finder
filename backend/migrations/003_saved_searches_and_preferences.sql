-- ============================================================================
-- NestIQ — Saved searches & user preferences (used by frontend Supabase JS)
-- Run via Supabase SQL Editor or pooler connection.
-- ============================================================================

-- ── 1. Saved searches ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS saved_searches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    name            TEXT NOT NULL DEFAULT '',
    location        TEXT NOT NULL DEFAULT '',
    bhk             TEXT NOT NULL DEFAULT '',
    budget          INTEGER,
    keywords        TEXT NOT NULL DEFAULT '',
    sources         TEXT[] DEFAULT '{telegram,nobroker,housing}',
    min_quality     INTEGER NOT NULL DEFAULT 20,
    last_run_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user
    ON saved_searches (user_id, created_at DESC);

ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY saved_searches_select ON saved_searches
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY saved_searches_insert ON saved_searches
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY saved_searches_update ON saved_searches
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY saved_searches_delete ON saved_searches
    FOR DELETE USING (auth.uid() = user_id);


-- ── 2. User preferences ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id             UUID PRIMARY KEY,
    default_location    TEXT NOT NULL DEFAULT '',
    default_bhk         TEXT NOT NULL DEFAULT '',
    default_budget      INTEGER,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_prefs_select ON user_preferences
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_prefs_insert ON user_preferences
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_prefs_update ON user_preferences
    FOR UPDATE USING (auth.uid() = user_id);
