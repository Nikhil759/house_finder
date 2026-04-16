-- Add is_listing column to listings_curated for filtering non-listing posts
ALTER TABLE listings_curated ADD COLUMN IF NOT EXISTS is_listing BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_curated_is_listing
    ON listings_curated (is_listing) WHERE is_listing = FALSE;
