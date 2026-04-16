# Architecture Migration Plan

This document tracks all changes required to bring the live system to the desired state described in `data_pipeline_architecture.md`.

---

## 1. Orchestration — Migrate to Railway Cron + Local Cron ✅

**Current state:** Individual ingestion scripts are triggered by macOS crontab entries running locally.  
**Desired state:** 4 non-Reddit jobs run via Railway Cron, 2 Reddit jobs remain on local crontab. Fast-path transforms are called at the end of each ingestion script's `main()`.

### Tasks
- [x] Wire fast-path transform calls into all 6 ingestion scripts (`run_post_ingest_transforms` / `run_post_pulse_transforms`)
- [x] Create `transforms/` module with `fast_path.py`, `db.py` (transform run tracking), `check_health.py`
- [x] Create `transform_runs` table migration (`010_transform_runs.sql`)
- [ ] Set up Railway Cron services for the 4 non-Reddit scripts:
  - `ingest_nobroker.py` — every 3 hours (`0 */3 * * *`)
  - `ingest_housing.py` — every 3 hours (`10 */3 * * *`)
  - `ingest_telegram.py` — every 3 hours (`20 */3 * * *`)
  - `scrape_news.py` — every 6 hours (`45 */6 * * *`)
- [ ] Keep local macOS crontab for the 2 Reddit scripts:
  - `ingest_reddit.py` — every 6 hours (`0 */6 * * *`)
  - `scrape_reddit_discussions.py` — every 6 hours (`30 */6 * * *`)
- [ ] Set up Railway Cron for the hourly health check (`python -m transforms.check_health`)
- [ ] Retire the testing wrapper scripts (`run_all.py`, `run_pulse_cron.sh`, etc.) or move to `scripts/dev/`

---

## 2. Database — Drop Dead Tables

The following tables exist in the schema but are not used by any active code path. They should be dropped to keep the schema clean.

### `listing_price_history`
- **Why drop:** Written to by `db.py` on price changes but never read by any frontend page or API. Only 36 real price-change events recorded across all of history (out of 4,663 listings). Not worth the complexity.
- **Before dropping:** Confirm no new reads have been added since last audit.
- [ ] `DROP TABLE listing_price_history;`
- [ ] Remove the insert block in `backend/ingestion/db.py` that writes to this table

### `user_listing_interactions`
- **Why drop:** Created speculatively in `001_initial_schema.sql` for future ML use. Nothing in the frontend or backend writes to or reads from it.
- [ ] `DROP TABLE user_listing_interactions;`

### `user_profiles`
- **Why drop:** Superseded by `user_preferences` (migration 003), which is the table actually used by the frontend. `user_profiles` has no active reads or writes.
- [ ] `DROP TABLE user_profiles;`

---

## 3. Database — Automate Nightly Stats Refresh via Supabase Cron

**Current state:** The `refresh_locality_stats()` Postgres function exists but is triggered manually. The cache is currently 3+ days stale.  
**Desired state:** The function runs automatically every night.

### Tasks
- [ ] In the Supabase Dashboard, go to **Database → Extensions** and enable `pg_cron` if not already enabled
- [ ] Add a pg_cron job to call `refresh_locality_stats()` nightly:
  ```sql
  SELECT cron.schedule(
    'nightly-locality-stats-refresh',
    '0 2 * * *',  -- 2:00 AM UTC daily
    $$SELECT refresh_locality_stats()$$
  );
  ```
- [ ] Verify the cache `updated_at` timestamps advance each day after enabling

---

## 4. Ingestion — Remove Transform Logic from Ingestion Scripts

**Current state:** Two pieces of classification logic are embedded inside the ingestion scripts rather than the Transform Layer:
1. `mark_stale()` — called at the end of every ingest script run
2. `compute_quality_score()` — called at ingest time, score stored directly on the `listings` row

**Desired state:** Ingestion scripts only fetch and upsert raw data. Classification and scoring are handled by the Transform Layer.

### Tasks
- [ ] Remove `mark_stale()` calls from all ingestion scripts (`ingest_nobroker.py`, `ingest_housing.py`, `ingest_telegram.py`, `ingest_reddit.py`)
- [ ] Move stale-marking into a dedicated Transform Layer job that reads `started_at` from `ingestion_runs` as the cycle boundary — keeping the same logic but decoupled from the ingestion runtime
- [ ] Remove `compute_quality_score()` calls from ingestion scripts — score should be computed by the Transform Layer after normalization, not at raw ingest time
- [ ] Deduplication (`run_dedup.py`) is also a Transform Layer concern — scheduling and productionizing it is covered in the Transform Layer plan

---

## 5. Database — Extend `locality_stats_cache` with Price-Per-Sqft ✅

**Current state:** `locality_stats_cache` stores median/P25/P75 rent and `rent_trend_pct` per locality+BHK but does not store price-per-sqft metrics.  
**Desired state:** The cache also stores `median_price_per_sqft` per locality+BHK to power the area-adjusted price competitiveness scoring in the Transform Layer.

### Tasks
- [x] Add `median_price_per_sqft NUMERIC(8,2)` column to `locality_stats_cache`
- [x] Update `refresh_locality_stats()` Postgres function to compute and store `median_price_per_sqft` from listings where both `rent` and `area_sqft` are present
- [x] Ensure the computation only uses listings with `status IN ('active', 'stale')` and excludes outlier area values (< 100 sqft or > 10,000 sqft)

*Implemented in `011_listings_curated.sql`.*

---

## 6. Transform Layer — Build Listings Pipeline

**Current state:** No Transform Layer exists. Classification, scoring, and normalization all happen inside ingestion scripts.  
**Desired state:** A dedicated Transform Layer pipeline runs after each ingestion cycle and produces a `listings_curated` table that the frontend reads from.

### Tasks

**Schema:**
- [x] Create `listings_curated` table (`011_listings_curated.sql`) with:
  - `quality_score`, `detail_score`, `price_comp_score`, `locality_sent_score`, `freshness_score`
  - `price_anomaly` (BOOLEAN) — rent > 2σ from locality+BHK median
  - `is_per_room` (BOOLEAN), `rent_type` (TEXT: `"whole" / "per_room" / "unknown"`)
  - `extracted_bhk`, `extracted_rent`, `extracted_locality` — LLM-filled values for Reddit/Telegram rows
  - `gemini_tagged` (BOOLEAN), `gemini_fallback` (BOOLEAN)

**Fast-path jobs (event-driven, wired to each ingestion flow):**
- [x] Fuzzy locality matching job (`transforms/locality_matcher.py`) — rapidfuzz second pass for unmatched Reddit/Telegram posts
- [ ] Reddit/Telegram listing filter + structured extraction job (Gemini Flash Lite):
  - Regex pre-filter drops obvious non-listings ("looking for", "seeking", "need flatmate")
  - Single batch Gemini call returns `is_listing` boolean + all structured fields + `rent_type`
  - Posts with `is_listing = false` are excluded from `listings_curated`
  - Set `gemini_tagged = true` on success; `gemini_fallback = true` + Claude Haiku retry on API error
- [x] Stale marking job — wired via `run_post_ingest_transforms()` calling `mark_stale()` (Phase 1)

**Slow-path jobs (daily at 2:30–2:45 AM UTC):**
- [x] Full quality rescoring job (`transforms/slow_path.py::run_quality_rescoring`) — 4-dimension composite score with source-aware weights:
  - Detail score (0–20): field completeness
  - Price competitiveness (0–35 NoBroker/Housing, 0–30 Reddit/Telegram): rent vs locality+BHK median, area-adjusted when `area_sqft` available
  - Locality sentiment (0–30 / 0–20): 30-day rolling avg `sentiment_score` from `locality_feed`
  - Freshness (0–15 / 0–30): exponential decay `max × e^(-0.1 × age_in_days)`
- [x] Cross-source deduplication (`transforms/slow_path.py::run_cross_source_dedup`)
- [x] Rent anomaly flagging (`transforms/slow_path.py::run_rent_anomaly_flagging`) — sets `price_anomaly`, `is_per_room`, `rent_type`

**Wiring & switch:**
- [x] Wire fast-path jobs as function calls at the end of each ingestion script's `main()` (done in Phase 1)
- [ ] Wire slow-path jobs as Railway Cron service: `python -m transforms.slow_path` at 2:30 AM UTC
- [ ] Switch backend API and frontend to read from `listings_curated` instead of `listings`

---

## 7. Transform Layer — Build Pulse Pipeline

**Current state:** Pulse tagging (Gemini) runs as part of the ingestion pipeline and writes back to `locality_feed` in-place. No curation or editorial layer exists.  
**Desired state:** A dedicated Pulse transform pipeline produces `feed_curated` and `pulse_feed_state` tables with filtered, trend-detected, and editorially ranked posts.

### Tasks

**Schema:**
- [ ] Create `feed_curated` table with all columns from `locality_feed` plus:
  - `featured` (BOOLEAN), `editor_rank` (INTEGER), `editor_note` (TEXT)
  - `is_trending` (BOOLEAN), `trending_score` (FLOAT)
  - `gemini_tagged` (BOOLEAN), `gemini_fallback` (BOOLEAN)
- [ ] Create `pulse_feed_state` table (single-row state):
  - `feed_refreshed_at` (TIMESTAMP) — timestamp of last editor agent run, shown in UI as "Last updated"
  - `editor_shortlist_size` (INTEGER) — count of posts the editor was given to rank from
  - `trending_topics` (JSONB) — list of currently trending `canonical_topic` slugs

**Fast-path jobs (event-driven, wired to Pulse ingestion flows):**
- [ ] Category filter job — exclude `listing`, `flatmate_search`, `spam` category posts from `feed_curated`
- [ ] Duplicate news dedup job — drop near-duplicate news articles (> 85% title similarity) before Gemini tagging; keep highest-engagement version
- [ ] Gemini Flash Lite tagging job (existing, move to fast-path) — category, topic, sentiment, locality NER, relevance in a single batch call; set `gemini_tagged = true` / `gemini_fallback = true`

**Slow-path jobs (daily at 3:00 AM UTC):**
- [ ] Trend detection job (SQL-based):
  - Ratio formula: `spike_ratio = recent_72h_count / (3 × 7day_daily_avg)`
  - Flag `is_trending = true` when `spike_ratio ≥ 2.0` AND `recent_72h_count ≥ 5`
  - Write `trending_score = spike_ratio` to enable ordering multiple trending topics
- [ ] Editor/Curator Agent job (Gemini Flash):
  - Pool: posts from the **last 24 hours** with `relevance_score > 0.6` and `category IN ('discussion', 'news')`
  - Pre-filter: if pool > 200 posts, keep top 200 by `(sentiment_score * relevance_score)`
  - Exclusion: skip posts already `featured = true` in the previous cycle
  - Prompt: LLM acts as a city editor and **ranks** (not scores) the filtered batch
  - Output per post: `editor_rank`, `editor_note` (1-sentence rationale), `featured = true`
  - Re-process `gemini_fallback = true` rows from previous cycles when API is healthy
- [ ] `gemini_fallback` re-processing: nightly job finds all `gemini_fallback = true` rows in both `listings_curated` and `feed_curated` and retries them

**Wiring & switch:**
- [x] Wire Pulse fast-path jobs as function calls at the end of `scrape_reddit_discussions` and `scrape_news` (done in Phase 1)
- [ ] Wire slow-path jobs (trend detection, editor agent) as Railway Cron services on 3:00 AM UTC schedule
- [ ] Switch Pulse frontend page to read from `feed_curated` instead of `locality_feed`
- [ ] Update frontend Pulse header to derive "Last updated" from `SELECT MAX(updated_at) FROM feed_curated WHERE featured = true` (no separate state table needed)

---

## 8. Observability — `transform_runs` Table, Alerts & Internal Dashboard

**Current state:** No visibility into transform job health, Gemini failure rates, or which records are affected by LLM fallbacks.  
**Desired state:** A `transform_runs` table provides per-job audit logs, `gemini_fallback` flags on curated tables enable targeted re-processing, and a custom internal dashboard surfaces pipeline health at a glance.

### Tasks

**Database:**
- [ ] Create `transform_runs` table:
  ```sql
  CREATE TABLE transform_runs (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name              TEXT NOT NULL,
    started_at            TIMESTAMPTZ NOT NULL,
    completed_at          TIMESTAMPTZ,
    status                TEXT NOT NULL,  -- 'success' | 'partial' | 'failed'
    records_processed     INTEGER,
    records_failed        INTEGER,
    gemini_calls          INTEGER,
    gemini_fallback_count INTEGER,
    error_message         TEXT
  );
  ```

**Run tracking:**
- [x] Create `transforms/db.py` with `record_transform_start()` / `record_transform_end()` helpers (done in Phase 1)
- [x] All fast-path transform jobs write to `transform_runs` on start and completion/failure (done in Phase 1)
- [ ] Add a post-job check to each Gemini-using job: if `gemini_fallback_count / gemini_calls > 0.1`, log a warning in `transform_runs.metadata` and fire a webhook alert

**Alerts:**
- [ ] Add `transforms/check_health.py` to Railway Cron (every hour) to detect stale sources and elevated Gemini fallback rates
- [ ] Add a SQL-based sentiment anomaly check to the daily slow-path run: if a locality's 24h avg `sentiment_score` has dropped > 0.3 vs its 7-day rolling avg, log it as an anomaly row in `transform_runs` (or a dedicated `alerts` table if volume warrants it)
- [ ] Add a silent-source check: if any source's `ingestion_runs.completed_at` is more than 2× its expected interval old, surface it on the internal dashboard as stale

**Internal dashboard:**
- [ ] Expose `ingestion_runs` and `transform_runs` via a `/api/pipeline-status` endpoint (extend the existing one)
- [ ] Build a lightweight internal React page displaying:
  - Per-job status grid for the last 7 days (green / yellow / red per job per day)
  - Gemini fallback rate per job — highlighted when > 10%
  - Pending re-processing count: `SELECT COUNT(*) FROM listings_curated WHERE gemini_fallback = true` and same for `feed_curated`
  - Active listing health: count of `active / stale / expired` listings per source

---

## 9. API Layer — New Endpoints & Frontend Migration

**Current state:** The Pulse page and Locality Guide page query Supabase directly from the frontend JS client, aggregating data in JavaScript. The Flask backend has no Pulse or locality-stats endpoints.  
**Desired state:** All data access goes through the Flask backend API. The frontend is a pure display layer.

### Tasks

**New Pulse endpoints (Flask):**
- [ ] `GET /api/pulse/feed` — query `feed_curated`, return `featured` posts first then remainder ordered by `relevance_score DESC`. Support optional `?locality=` and `?topic=` query params.
- [ ] `GET /api/pulse/topics` — aggregate `canonical_topic` counts and avg `sentiment_score` from `feed_curated` for the last 30 days. Replace the frontend JS aggregation currently done on raw `locality_feed` rows.
- [ ] `GET /api/pulse/trending` — return rows from `feed_curated WHERE is_trending = true ORDER BY trending_score DESC`.
- [ ] `GET /api/pulse/locality/<locality>` — locality-specific sentiment summary: 7-day avg sentiment, top topics by post count, recent high-relevance posts. Used by Locality Guide detail page.

**New locality-stats endpoint (Flask):**
- [ ] `GET /api/locality-stats/<locality>` — return median rent, P25/P75, deposit stats, `median_price_per_sqft` per BHK from `locality_stats_cache` and `deposit_stats_cache`. Replace the direct Supabase JS client call currently made by the Locality Guide frontend.

**Extend existing pipeline-status endpoint:**
- [ ] Add `transform_runs` data (last run per job, Gemini fallback rate) and `gemini_fallback` pending counts from `listings_curated` and `feed_curated` to the existing `/api/pipeline-status` response.

**Frontend migration:**
- [ ] Pulse page (`Pulse.jsx`): replace the 4 direct Supabase queries with calls to `/api/pulse/feed`, `/api/pulse/topics`, `/api/pulse/trending`. Remove all in-JS aggregation logic (topic grouping, sentiment averaging, trend detection — all now done server-side or in the DB).
- [ ] Locality Guide pages (`LocalityGuide.jsx`, `LocalityDetail.jsx`): replace direct `locality_stats_cache` and `deposit_stats_cache` Supabase queries with `/api/locality-stats/<locality>` and `/api/pulse/locality/<locality>`.
- [ ] Locality Guide sentiment map: replace the direct `locality_feed` Supabase query (currently fetching 7-day posts and averaging in JS) with `/api/pulse/locality/<locality>` which returns the pre-computed average.

---

## 10. Frontend — Stale Listing Badge on My Hub (Saved Leads)

**Current state:** Saved listings in My Hub always render as if they are active, even if the listing has since gone stale on the platform.  
**Desired state:** The page cross-references `listings.status` and shows a visual "No longer active" badge on stale saved listings. The full listing details remain visible via the stored `listing_snapshot`.

### Tasks
- [ ] On the My Hub page load, fetch `listings.status` for all saved listing IDs in a single query (join or `in` filter on primary key — fast, indexed)
- [ ] Overlay a stale badge/banner on the listing card when `status = 'stale'`
- [ ] Ensure the card still renders full details from `listing_snapshot` regardless of stale status
