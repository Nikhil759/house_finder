-- Phase 0 Cleanup Migration
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- ─────────────────────────────────────────────
-- 1. Drop dead tables
-- ─────────────────────────────────────────────
-- listing_price_history: written to by db.py on rent changes but never read
-- by any API or frontend page. Only 36 real price-change events recorded
-- across 4,663+ listings. Dropped in favour of computing price history
-- directly from the listings table if ever needed.
DROP TABLE IF EXISTS listing_price_history CASCADE;

-- user_listing_interactions: created speculatively in 001_initial_schema.sql
-- for future ML use. Nothing in the frontend or backend ever writes to or
-- reads from it.
DROP TABLE IF EXISTS user_listing_interactions CASCADE;

-- user_profiles: superseded by user_preferences (migration 003).
-- user_preferences is the table actually used by the frontend.
-- user_profiles has no active reads or writes.
DROP TABLE IF EXISTS user_profiles CASCADE;


-- ─────────────────────────────────────────────
-- 2. Automate nightly locality stats refresh via Supabase Cron (pg_cron)
-- ─────────────────────────────────────────────
-- Prerequisites:
--   a) Enable the pg_cron extension in Supabase Dashboard →
--      Database → Extensions → search "pg_cron" → enable it.
--   b) Then run the statement below.
--
-- This schedules refresh_locality_stats() to run at 2:00 AM UTC every night,
-- keeping locality_stats_cache and deposit_stats_cache fresh for the
-- quality scoring and Locality Guide pages.

SELECT cron.schedule(
    'nightly-locality-stats-refresh',
    '0 2 * * *',
    $$SELECT refresh_locality_stats()$$
);

-- To verify the job was created:
-- SELECT * FROM cron.job;

-- To manually trigger a refresh now (to test):
-- SELECT refresh_locality_stats();

-- To remove the job if needed:
-- SELECT cron.unschedule('nightly-locality-stats-refresh');
