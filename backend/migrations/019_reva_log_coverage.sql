-- Track which pulse signals Reva already tweeted about (anti-repetition).
ALTER TABLE reva_log
  ADD COLUMN IF NOT EXISTS feed_id integer,
  ADD COLUMN IF NOT EXISTS locality text,
  ADD COLUMN IF NOT EXISTS canonical_topic text;

CREATE INDEX IF NOT EXISTS idx_reva_log_posted_at ON reva_log (posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_reva_log_feed_id ON reva_log (feed_id) WHERE feed_id IS NOT NULL;
