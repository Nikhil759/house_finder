-- ============================================================================
-- Phase 2: Extend locality_stats_cache + create listings_curated table
-- ============================================================================

-- 1. Add median_price_per_sqft to locality_stats_cache
ALTER TABLE locality_stats_cache
  ADD COLUMN IF NOT EXISTS median_price_per_sqft NUMERIC(8,2);

-- 2. Update refresh_locality_stats() to compute price-per-sqft
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
    AND rent > 0
    AND deposit > 0
    -- Clamp to 1–12 months' rent to exclude regex misfires and outliers
    AND deposit >= rent
    AND deposit <= rent * 12
    AND bhk IN ('1 BHK', '2 BHK', '3 BHK')
  GROUP BY bhk
  ORDER BY bhk;
END;
$$;


-- ============================================================================
-- 3. Create listings_curated table
-- ============================================================================

CREATE TABLE IF NOT EXISTS listings_curated (
    listing_id          BIGINT PRIMARY KEY REFERENCES listings(id),

    -- Composite scores (0-100)
    quality_score       INTEGER DEFAULT 0,
    detail_score        INTEGER DEFAULT 0,
    price_comp_score    INTEGER DEFAULT 0,
    locality_sent_score INTEGER DEFAULT 0,
    freshness_score     INTEGER DEFAULT 0,

    -- Rent anomaly detection
    price_anomaly       BOOLEAN DEFAULT FALSE,
    is_per_room         BOOLEAN DEFAULT FALSE,
    rent_type           TEXT DEFAULT 'unknown',

    -- Extracted fields (Reddit/Telegram — Gemini-filled)
    extracted_bhk       TEXT,
    extracted_rent      INTEGER,
    extracted_locality  TEXT,

    -- Gemini tracking
    gemini_tagged       BOOLEAN DEFAULT FALSE,
    gemini_fallback     BOOLEAN DEFAULT FALSE,

    -- Dedup
    duplicate_group_id  BIGINT,

    -- Timestamps
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_curated_quality
    ON listings_curated (quality_score DESC);

CREATE INDEX IF NOT EXISTS idx_curated_anomaly
    ON listings_curated (price_anomaly) WHERE price_anomaly = TRUE;

CREATE INDEX IF NOT EXISTS idx_curated_gemini_fallback
    ON listings_curated (gemini_fallback) WHERE gemini_fallback = TRUE;

CREATE INDEX IF NOT EXISTS idx_curated_dedup
    ON listings_curated (duplicate_group_id) WHERE duplicate_group_id IS NOT NULL;

-- RLS
ALTER TABLE listings_curated ENABLE ROW LEVEL SECURITY;

CREATE POLICY listings_curated_select ON listings_curated
  FOR SELECT USING (true);
