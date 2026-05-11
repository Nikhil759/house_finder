-- ============================================================================
-- NestIQ — Listing views (renter view tracking)
--
-- Tracks "someone opened the listing detail page" so cards can show a small
-- "47 views" stat. Views are a SOFT, INFORMATIONAL signal — listing visibility
-- in search is NEVER affected by view count, and we never penalise low-view
-- listings.
--
-- Identity model (mirrors listing_flags exactly so the same client localStorage
-- UUID is reused — see frontend/src/hooks/useListingFlags.js#getDeviceId):
--   * Required: device_id (UUID generated client-side, stored in localStorage)
--   * Optional: user_id (Supabase auth.uid when signed in)
--   * Optional: ip_address (server-side fallback)
--
-- Dedupe rule (enforced server-side in view_store.log_view):
--   * Same (listing_id, device_id) within a 24-hour rolling window counts as
--     ONE view, not multiple. Keeps the count meaningful and prevents trivial
--     refresh inflation.
--
-- Read path:
--   * `listing_view_stats` is a precomputed cache of `total_views` per listing,
--     bumped inline by view_store.log_view on every NEW (non-deduped) insert.
--     Card rendering reads ONLY from this cache (one indexed lookup) so
--     /api/search never has to COUNT(*) the raw log table.
--
-- Run via Supabase SQL Editor.
-- ============================================================================

-- ── Raw view log ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listing_views (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Composite "source_sourceid" string the API exposes (matches listing_flags).
    listing_id  TEXT         NOT NULL,

    -- Identity (device required, user/ip optional)
    device_id   UUID         NOT NULL,
    user_id     UUID,
    ip_address  INET,

    viewed_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Hot path: "did this device view this listing in the last 24h?"
-- DESC on viewed_at so the dedupe check is a single indexed probe.
CREATE INDEX IF NOT EXISTS idx_listing_views_dedupe
    ON listing_views (listing_id, device_id, viewed_at DESC);

-- Useful for any future ad-hoc analytics ("recent views overall").
CREATE INDEX IF NOT EXISTS idx_listing_views_recent
    ON listing_views (viewed_at DESC);

-- ── Precomputed per-listing aggregate (read-side cache) ──────────────────────
-- Updated inline by view_store.log_view on every NEW view (deduped views skip
-- the increment entirely). Always-fresh, no cron needed.
CREATE TABLE IF NOT EXISTS listing_view_stats (
    listing_id    TEXT          PRIMARY KEY,
    total_views   INTEGER       NOT NULL DEFAULT 0,
    refreshed_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
