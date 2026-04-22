-- ============================================================================
-- NestIQ — Locality stats cache tables for the Locality Guide page.
-- Run via Supabase SQL Editor.
-- Refreshed nightly via Supabase cron / Edge Function.
-- ============================================================================

-- Median rent per locality + BHK (Query 1 results)
CREATE TABLE IF NOT EXISTS locality_stats_cache (
  locality        text,
  bhk             text,
  median_rent     integer,
  p25_rent        integer,
  p75_rent        integer,
  listing_count   integer,
  updated_at      timestamptz DEFAULT now(),
  PRIMARY KEY (locality, bhk)
);

-- Deposit multiplier per BHK (Query 2 results)
CREATE TABLE IF NOT EXISTS deposit_stats_cache (
  bhk              text PRIMARY KEY,
  median_deposit   integer,
  avg_multiplier   numeric(4,1),
  updated_at       timestamptz DEFAULT now()
);

-- Indexes for fast reads
CREATE INDEX IF NOT EXISTS idx_locality_stats_bhk
  ON locality_stats_cache (bhk, median_rent DESC);

-- ============================================================================
-- Refresh function — call this from a nightly cron job or Edge Function
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_locality_stats()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Refresh locality rent stats
  DELETE FROM locality_stats_cache;

  INSERT INTO locality_stats_cache (locality, bhk, median_rent, p25_rent, p75_rent, listing_count, updated_at)
  SELECT
    locality,
    bhk,
    PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY rent)::integer  AS median_rent,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY rent)::integer  AS p25_rent,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY rent)::integer  AS p75_rent,
    COUNT(*)                                                      AS listing_count,
    now()
  FROM listings
  WHERE status IN ('active', 'stale')
    AND rent IS NOT NULL
    AND rent > 3000
    AND rent < 500000
    AND locality IS NOT NULL
    AND bhk IN ('1 BHK', '2 BHK', '3 BHK')
  GROUP BY locality, bhk
  HAVING COUNT(*) >= 15
  ORDER BY median_rent DESC;

  -- Refresh deposit stats
  DELETE FROM deposit_stats_cache;

  INSERT INTO deposit_stats_cache (bhk, median_deposit, avg_multiplier, updated_at)
  SELECT
    bhk,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY deposit)::integer          AS median_deposit,
    ROUND(AVG(deposit::numeric / NULLIF(rent, 0)), 1)                      AS avg_multiplier,
    now()
  FROM listings
  WHERE status IN ('active', 'stale')
    AND deposit IS NOT NULL
    AND rent IS NOT NULL
    AND rent > 0
    AND deposit > 0
    AND deposit >= rent
    AND deposit <= rent * 12
    AND bhk IN ('1 BHK', '2 BHK', '3 BHK')
  GROUP BY bhk
  ORDER BY bhk;
END;
$$;

-- Enable RLS (read is public; writes only via service role / function)
ALTER TABLE locality_stats_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_stats_cache  ENABLE ROW LEVEL SECURITY;

CREATE POLICY locality_stats_select ON locality_stats_cache
  FOR SELECT USING (true);

CREATE POLICY deposit_stats_select ON deposit_stats_cache
  FOR SELECT USING (true);
