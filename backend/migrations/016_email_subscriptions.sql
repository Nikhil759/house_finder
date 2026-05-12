-- ============================================================================
-- NestIQ — Email subscriptions for digest alerts
-- Run via Supabase SQL Editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_subscriptions (
    user_id                        UUID PRIMARY KEY,
    email                          TEXT NOT NULL,

    -- New Listings Digest
    new_listings_email_subscribed   BOOLEAN NOT NULL DEFAULT true,
    new_listings_frequency          TEXT NOT NULL DEFAULT 'daily'
        CHECK (new_listings_frequency IN ('daily', 'every_3_days', 'every_5_days', 'weekly')),
    last_digest_sent_at            TIMESTAMPTZ,
    disabled_localities            TEXT[] NOT NULL DEFAULT '{}',

    -- Master kill-switch
    all_emails_unsubscribed        BOOLEAN NOT NULL DEFAULT false,

    -- Welcome email tracking (NULL = never sent)
    welcome_sent_at                TIMESTAMPTZ,

    -- Delivery health
    hard_bounce_at                 TIMESTAMPTZ,
    spam_complaint_at              TIMESTAMPTZ,

    created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index for the cron query: only eligible users
CREATE INDEX IF NOT EXISTS idx_email_subs_digest
    ON email_subscriptions (new_listings_email_subscribed, new_listings_frequency)
    WHERE new_listings_email_subscribed = true
      AND all_emails_unsubscribed = false
      AND hard_bounce_at IS NULL
      AND spam_complaint_at IS NULL;

-- Look up by email (for Resend webhook bounce/complaint matching)
CREATE INDEX IF NOT EXISTS idx_email_subs_email
    ON email_subscriptions (email);

ALTER TABLE email_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can read their own subscription
CREATE POLICY email_subscriptions_select ON email_subscriptions
    FOR SELECT USING (auth.uid() = user_id);

-- Users can update their own subscription (toggle, frequency)
CREATE POLICY email_subscriptions_update ON email_subscriptions
    FOR UPDATE USING (auth.uid() = user_id);

-- INSERT is done by the backend (bypasses RLS via direct Postgres connection),
-- not by the frontend Supabase client.  No INSERT policy needed.
