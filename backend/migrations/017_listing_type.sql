-- ============================================================================
-- NestIQ — Add listing_type discriminator for PG / flatmate inventory
-- Run via Supabase SQL Editor.
-- ============================================================================

-- 1. Add listing_type + type_attributes columns
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS listing_type text NOT NULL DEFAULT 'full_house'
    CHECK (listing_type IN ('full_house', 'pg', 'flatmate')),
  ADD COLUMN IF NOT EXISTS type_attributes jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_listings_listing_type ON listings(listing_type);

-- 2. Re-declare refresh_locality_stats() with listing_type filter
CREATE OR REPLACE FUNCTION refresh_locality_stats()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM locality_stats_cache;

  INSERT INTO locality_stats_cache
    (locality, bhk, median_rent, p25_rent, p75_rent, listing_count,
     rent_trend_pct, median_price_per_sqft, updated_at)
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
      AND listing_type = 'full_house'
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
      AND listing_type = 'full_house'
    GROUP BY locality, bhk
    HAVING COUNT(*) >= 10
  ),
  price_per_sqft AS (
    SELECT
      locality, bhk,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY rent::numeric / area_sqft)::numeric(8,2) AS median_ppsf
    FROM listings
    WHERE status IN ('active', 'stale')
      AND rent IS NOT NULL AND rent > 3000 AND rent < 500000
      AND area_sqft IS NOT NULL AND area_sqft >= 100 AND area_sqft <= 10000
      AND locality IS NOT NULL
      AND bhk IN ('1 BHK', '2 BHK', '3 BHK')
      AND listing_type = 'full_house'
    GROUP BY locality, bhk
    HAVING COUNT(*) >= 5
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
    pps.median_ppsf,
    NOW()
  FROM current_period c
  LEFT JOIN previous_period p USING (locality, bhk)
  LEFT JOIN price_per_sqft pps USING (locality, bhk)
  ORDER BY c.median_rent DESC;

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
    AND rent > 0
    AND deposit > 0
    AND deposit >= rent
    AND deposit <= rent * 12
    AND bhk IN ('1 BHK', '2 BHK', '3 BHK')
    AND listing_type = 'full_house'
  GROUP BY bhk
  ORDER BY bhk;
END;
$$;
