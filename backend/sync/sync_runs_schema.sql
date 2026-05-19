-- Sync health tracking table for the SQLite replica sync job.
-- Run this manually against Supabase via the SQL Editor.

CREATE TABLE IF NOT EXISTS sync_runs (
    id              BIGSERIAL PRIMARY KEY,
    sync_run_id     UUID NOT NULL,
    started_at      TIMESTAMP WITH TIME ZONE NOT NULL,
    finished_at     TIMESTAMP WITH TIME ZONE,
    status          TEXT NOT NULL DEFAULT 'running',  -- running | success | partial | error
    trigger_reason  TEXT,                              -- e.g., "ingest_nobroker", "scheduled_safety_net", "manual"
    dry_run         BOOLEAN DEFAULT FALSE,
    total_duration_ms  INTEGER,
    total_rows_read    INTEGER,
    total_rows_written INTEGER,
    success_count   INTEGER,
    error_count     INTEGER,
    per_table_stats JSONB,                             -- full sync result for inspection
    error_message   TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_started_at ON sync_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_runs_status ON sync_runs (status);
