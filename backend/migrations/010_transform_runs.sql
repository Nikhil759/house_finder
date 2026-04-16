-- Transform Layer run tracking table
-- Mirrors ingestion_runs for transform jobs: scoring, dedup, stale marking, etc.

CREATE TABLE IF NOT EXISTS transform_runs (
    id                    SERIAL PRIMARY KEY,
    job_name              TEXT NOT NULL,
    source                TEXT,
    started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at           TIMESTAMPTZ,
    status                TEXT NOT NULL DEFAULT 'running',
    duration_ms           INTEGER,
    records_processed     INTEGER DEFAULT 0,
    records_failed        INTEGER DEFAULT 0,
    records_skipped       INTEGER DEFAULT 0,
    gemini_calls          INTEGER DEFAULT 0,
    gemini_fallback_count INTEGER DEFAULT 0,
    error_message         TEXT,
    metadata              JSONB
);

CREATE INDEX IF NOT EXISTS idx_transform_runs_job_started
    ON transform_runs (job_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_transform_runs_status
    ON transform_runs (status) WHERE status != 'success';
