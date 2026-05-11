-- ============================================================================
-- NestIQ — Listing flags (renter reports)
--
-- Anonymous-friendly listing reports. Renters can flag listings as fake,
-- already rented, broker-posing, etc. Flags are a SOFT SIGNAL ONLY —
-- listing visibility in search is NEVER affected by flag count.
--
-- Identity model:
--   * Required: device_id (UUID generated client-side, stored in localStorage)
--   * Optional: user_id (Supabase auth.uid when signed in)
--   * Optional: ip_address (server-side fallback for rate-limiting)
--
-- Anti-abuse rules (enforced server-side):
--   * UNIQUE (listing_id, device_id) WHERE retracted_at IS NULL
--     → one active flag per device per listing
--   * Max 5 flags per device per 24h (enforced in app code via index lookup)
--   * Max 5 flags per IP per 24h (fallback when localStorage is wiped)
--
-- Run via Supabase SQL Editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS listing_flags (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Listing identity (composite "source_sourceid" string the API exposes;
    -- stored as TEXT so live-cache listings without a DB row can also be flagged)
    listing_id      TEXT         NOT NULL,

    -- Required category — one of the seven allowed reasons
    category        TEXT         NOT NULL CHECK (category IN (
        'already_rented',
        'fake_or_duplicate',
        'photos_dont_match',
        'contact_doesnt_work',
        'wrong_price_or_details',
        'not_a_listing',
        'other'
    )),

    -- Optional context note (capped at 500 chars in app code)
    note            TEXT,

    -- Identity (device required, user/ip optional)
    device_id       UUID         NOT NULL,
    user_id         UUID,
    ip_address      INET,

    -- Internal tracking flag — stored for future analysis only.
    -- Never displayed in UI and never used to weight signals at this stage.
    was_signed_in   BOOLEAN      NOT NULL DEFAULT FALSE,

    -- Retraction (soft-delete so original counts remain auditable)
    retracted_at    TIMESTAMPTZ,

    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One ACTIVE flag per device per listing.
-- Partial unique index lets the same device flag again after retracting.
CREATE UNIQUE INDEX IF NOT EXISTS uq_listing_flags_device_active
    ON listing_flags (listing_id, device_id)
    WHERE retracted_at IS NULL;

-- Aggregating active flags by listing (count + top category, detail page reports)
CREATE INDEX IF NOT EXISTS idx_listing_flags_listing_active
    ON listing_flags (listing_id)
    WHERE retracted_at IS NULL;

-- Per-device rate limiting (5 / 24h)
CREATE INDEX IF NOT EXISTS idx_listing_flags_device_created
    ON listing_flags (device_id, created_at DESC);

-- Per-IP rate limiting fallback (5 / 24h)
CREATE INDEX IF NOT EXISTS idx_listing_flags_ip_created
    ON listing_flags (ip_address, created_at DESC)
    WHERE ip_address IS NOT NULL;

-- User-linked flag lookup (signed-in flags also stamped with user_id)
CREATE INDEX IF NOT EXISTS idx_listing_flags_user
    ON listing_flags (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;
