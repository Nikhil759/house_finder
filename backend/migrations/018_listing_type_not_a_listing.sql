-- ============================================================================
-- NestIQ — Extend listing_type to include 'not_a_listing' for non-rental posts
-- Run via Supabase SQL Editor.
-- ============================================================================

ALTER TABLE listings
  DROP CONSTRAINT IF EXISTS listings_listing_type_check;

ALTER TABLE listings
  ADD CONSTRAINT listings_listing_type_check
    CHECK (listing_type IN ('full_house', 'pg', 'flatmate', 'not_a_listing'));
