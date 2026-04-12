-- ============================================================================
-- NestIQ — Add rent trend (% change vs prior 30 days) to locality stats cache.
-- Run via Supabase SQL Editor.
-- ============================================================================

ALTER TABLE locality_stats_cache
  ADD COLUMN IF NOT EXISTS rent_trend_pct NUMERIC(5,1);

-- ============================================================================
-- Replace refresh function to also compute 30-day rent trend.
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_locality_stats()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM locality_stats_cache;

  INSERT INTO locality_stats_cache
    (locality, bhk, median_rent, p25_rent, p75_rent, listing_count, rent_trend_pct, updated_at)
  WITH current_period AS (
    SELECT
      locality, bhk,
      PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY rent)::integer AS median_rent,
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY rent)::integer AS p25_rent,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY rent)::integer AS p75_rent,
      COUNT(*) AS listing_count
    FROM listings
    WHERE status IN ('active', 'stale')
      AND rent IS NOT NULL
      AND rent > 3000
      AND rent < 500000
      AND locality IS NOT NULL
      AND bhk IN ('1 BHK', '2 BHK', '3 BHK')
    GROUP BY locality, bhk
    HAVING COUNT(*) >= 15
  ),
  previous_period AS (
    SELECT
      locality, bhk,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY rent)::integer AS median_rent,
      COUNT(*) AS cnt
    FROM listings
    WHERE first_seen_at < NOW() - INTERVAL '30 days'
      AND rent IS NOT NULL
      AND rent > 3000
      AND rent < 500000
      AND locality IS NOT NULL
      AND bhk IN ('1 BHK', '2 BHK', '3 BHK')
    GROUP BY locality, bhk
    HAVING COUNT(*) >= 10
  )
  SELECT
    c.locality,
    c.bhk,
    c.median_rent,
    c.p25_rent,
    c.p75_rent,
    c.listing_count,
    CASE
      WHEN p.median_rent IS NOT NULL AND p.median_rent > 0
      THEN ROUND(((c.median_rent - p.median_rent)::numeric / p.median_rent) * 100, 1)
      ELSE NULL
    END AS rent_trend_pct,
    NOW()
  FROM current_period c
  LEFT JOIN previous_period p USING (locality, bhk)
  ORDER BY c.median_rent DESC;

  -- Refresh deposit stats (unchanged)
  DELETE FROM deposit_stats_cache;

  INSERT INTO deposit_stats_cache (bhk, median_deposit, avg_multiplier, updated_at)
  SELECT
    bhk,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY deposit)::integer AS median_deposit,
    ROUND(AVG(deposit::numeric / NULLIF(rent, 0)), 1) AS avg_multiplier,
    NOW()
  FROM listings
  WHERE status IN ('active', 'stale')
    AND deposit IS NOT NULL
    AND rent IS NOT NULL
    AND deposit > 0
    AND bhk IN ('1 BHK', '2 BHK', '3 BHK')
  GROUP BY bhk
  ORDER BY bhk;
END;
$$;
