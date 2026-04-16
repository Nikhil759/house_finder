# Architecture Migration Plan

This document tracks all changes required to bring the live system to the desired state described in `data_pipeline_architecture.md`.

---

## 1. Orchestration — Migrate to Railway Cron + Local Cron ✅

**Desired state:** 4 non-Reddit jobs run via Railway Cron, 2 Reddit jobs remain on local crontab. Fast-path transforms are called at the end of each ingestion script's `main()`.

### Tasks
- [x] Wire fast-path transform calls into all 6 ingestion scripts (`run_post_ingest_transforms` / `run_post_pulse_transforms`)
- [x] Create `transforms/` module with `fast_path.py`, `db.py` (transform run tracking), `check_health.py`
- [x] Create `transform_runs` table migration (`010_transform_runs.sql`)
- [x] Set up Railway Cron services for the 4 non-Reddit scripts
- [x] Keep local macOS crontab for the 2 Reddit scripts
- [x] Set up Railway Cron for the hourly health check (`python -m transforms.check_health`)
- [ ] Retire the testing wrapper scripts (`run_all.py`, `run_pulse_cron.sh`, etc.) or move to `scripts/dev/`

---

## 2. Database — Drop Dead Tables ✅

- [x] `DROP TABLE listing_price_history;` (via `009_phase0_cleanup.sql`)
- [x] `DROP TABLE user_listing_interactions;`
- [x] `DROP TABLE user_profiles;`

---

## 3. Database — Automate Nightly Stats Refresh via Supabase Cron ✅

- [x] Enable `pg_cron` in Supabase Dashboard
- [x] Schedule `refresh_locality_stats()` nightly at 2 AM UTC
- [x] Verify cache `updated_at` timestamps advance each day

---

## 4. Ingestion — Transform Logic Decoupled ✅

Stale marking and quality scoring are now handled by the Transform Layer (fast-path and slow-path respectively). Legacy calls remain in ingestion scripts but are superseded by the transform pipeline.

- [x] Stale marking wired via `run_post_ingest_transforms()` → `mark_stale()`
- [x] Quality scoring handled by `transforms/slow_path.py::run_quality_rescoring`
- [x] Deduplication handled by `transforms/slow_path.py::run_cross_source_dedup`

---

## 5. Database — Extend `locality_stats_cache` with Price-Per-Sqft ✅

- [x] Add `median_price_per_sqft NUMERIC(8,2)` column
- [x] Update `refresh_locality_stats()` to compute it
- [x] Implemented in `011_listings_curated.sql`

---

## 6. Transform Layer — Build Listings Pipeline ✅

### Schema
- [x] `listings_curated` table (`011_listings_curated.sql`)
- [x] `is_listing` column (`013_is_listing.sql`)

### Fast-path jobs
- [x] Fuzzy locality matching (`transforms/locality_matcher.py`)
- [x] Listing filter + structured extraction (`transforms/listing_extractor.py`)
- [x] Stale marking via `run_post_ingest_transforms()`

### Slow-path jobs
- [x] Quality rescoring (`transforms/slow_path.py`)
- [x] Cross-source deduplication (`transforms/slow_path.py`)
- [x] Rent anomaly flagging (`transforms/slow_path.py`)
- [x] Railway Cron: `python -m transforms.slow_path` at 2:30 AM UTC

### Wiring
- [x] Fast-path wired into all ingestion scripts
- [x] Backend reads from `listings_curated` via JOIN in `listing_store.py`
- [x] Non-listings filtered out (`is_listing = FALSE` excluded from search)

---

## 7. Transform Layer — Build Pulse Pipeline ✅

### Schema
- [x] `feed_curated` table (`012_feed_curated.sql`)

### Fast-path jobs
- [x] Gemini tagging (`transforms/pulse_transforms.py::run_gemini_tagging`)
- [x] Category filter (`transforms/pulse_transforms.py::run_category_filter`)
- [x] News dedup (`transforms/pulse_transforms.py::run_news_dedup`)

### Slow-path jobs
- [x] Trend detection (`transforms/pulse_transforms.py::run_trend_detection`)
- [x] Editor/Curator Agent (`transforms/pulse_transforms.py::run_editor_agent`)
- [x] Gemini fallback re-processing (`transforms/pulse_transforms.py::run_gemini_fallback_reprocess`)
- [x] Railway Cron: `python -m transforms.pulse_transforms` at 3:00 AM UTC

### Wiring
- [x] Fast-path wired into `scrape_reddit_discussions` and `scrape_news`
- [x] Pulse frontend reads from `feed_curated` via `/api/pulse/feed`

---

## 8. Observability — `transform_runs` Table, Alerts & Internal Dashboard ✅

### Database & tracking
- [x] `transform_runs` table (`010_transform_runs.sql`)
- [x] `transforms/db.py` with `record_transform_start()` / `record_transform_end()`
- [x] All transform jobs write to `transform_runs`
- [x] `/api/pipeline-status` extended with `transform_runs` data + Gemini fallback pending counts
- [x] `transforms/check_health.py` running on Railway Cron (hourly)

### Internal dashboard
- [x] Observability dashboard built into existing `/health` page (ingestion runs, transform runs, Gemini fallback rates, listing health)

### Nice-to-have (deferred)
- [ ] Gemini fallback rate threshold alerting (> 10% → webhook)
- [ ] SQL-based sentiment anomaly check
- [ ] Silent-source detection surfaced on dashboard

---

## 9. API Layer — New Endpoints & Frontend Migration ✅

### Backend endpoints (all implemented)
- [x] `GET /api/pulse/feed` — curated feed with city sentiment + locality sentiments
- [x] `GET /api/pulse/topics` — aggregated topic counts + avg sentiment
- [x] `GET /api/pulse/trending` — trending posts from `feed_curated`
- [x] `GET /api/pulse/locality/<locality>` — locality sentiment summary
- [x] `GET /api/pulse/feed-for-locality/<locality>` — topic counts + posts per locality
- [x] `GET /api/pulse/rent-overview` — all locality rent stats
- [x] `GET /api/locality-stats/<locality>` — per-locality rent + deposit stats
- [x] `GET /api/locality-stats-all` — all locality stats + deposit benchmarks
- [x] `GET /api/locality-image/<locality>` — hero image for a locality
- [x] `/api/pipeline-status` extended with transform runs + Gemini pending

### Frontend migration (all pages off Supabase)
- [x] `Pulse.jsx` → Flask APIs
- [x] `PulseLocality.jsx` → Flask APIs
- [x] `LocalityDetail.jsx` → Flask APIs
- [x] `LocalityGuide.jsx` → Flask APIs
- [x] `ListingDetail.jsx` → Flask APIs

---

## 10. Frontend — Stale Listing Badge on My Hub (Saved Leads) ✅

- [x] Fetch `listings.status` for saved listing IDs via `/api/listing-statuses` endpoint
- [x] Show "No longer active" badge on stale/expired saved listings
- [x] Full listing details remain visible from `listing_snapshot`
