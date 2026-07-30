---
id: nestiq
name: NestIQ
slug: nestiq
file: architecture
category: platform
tags: [full-stack, data-intensive, proptech, bangalore, rag-ready]
employer: null
role: solo-builder
status: live
one_liner: Smart housing aggregator for Bangalore that scores and ranks rental listings from Reddit, Telegram, NoBroker, Housing.com, and PG platforms, with neighbourhood sentiment via Pulse.
stack: [React, Vite, Flask, Python, Supabase, PostgreSQL, Railway, Vercel, Gemini, PostHog, Resend, Telethon]
links:
  - label: Live site
    url: https://nestiq.homes
doc_type: project
visibility: public
related_files:
  - index.md
  - technical-decisions.md
  - data-model.md
  - media.md
  - faq.md
updated_at: 2026-06-19
---

# NestIQ — Architecture

## System Overview

NestIQ is a three-tier system: a React PWA frontend, a Flask API layer, and a Postgres data platform on Supabase with scheduled Python ingestion and transform jobs.

```
External sources (Reddit, Telegram, NoBroker, Housing.com, News, PG sites)
        ↓
  Ingestion Layer (cron — Railway, GHA, local crontab)
        ↓
  Raw Layer (listings, locality_feed, ingestion_runs)
        ↓
  Transform Layer (fast-path per ingest + slow-path nightly)
        ↓
  Curated Layer (listings_curated, feed_curated)
        ↓
  Flask API → React frontend
```

User-specific data (saved listings, searches, preferences, alerts) bypasses the curated pipeline and is written directly from the frontend to Supabase tables protected by Row Level Security.

## Ingestion Layer

Ingestion is split into two streams: **Listings** and **Pulse**.

### Listings sources

Scripts ingest rental inventory from:

- **NoBroker** — `ingest_nobroker.py`
- **Housing.com** — `ingest_housing.py`
- **Telegram** — `ingest_telegram.py` (MTProto via Telethon)
- **Reddit** — `ingest_reddit.py`
- **99acres** — `ingest_99acres.py` (active production source)
- **Zolo, Colive, Stanza** — PG/coliving operators (`ingest_zolo.py`, `ingest_colive.py`, `ingest_stanza.py`; Stanza is active production)

Each source has a dedicated cron schedule. Non-Reddit jobs run on Railway Cron or GitHub Actions. Reddit jobs run on a **local macOS crontab** because Reddit blocks cloud provider IP ranges (Railway/AWS/GCP).

### Pulse sources

Neighbourhood sentiment and news:

- **Reddit discussions** — `scrape_reddit_discussions.py`
- **Google News** — `scrape_news.py` / `scrape_google_news_rss.py`
- **Citizen Matters** — `scrape_citizen_matters.py` (supplementary local journalism feed)

### Dual-write normalisation

Every ingestion script normalises source data into a Pydantic `StandardListing` before writing. Normalisation covers price coercion (₹, annual quotes), BHK canonicalisation, furnishing labels, timestamp UTC conversion, and deposit sanity checks.

Both normalised columns **and** the original `raw_payload` JSONB are stored on each row. The raw layer is the source of truth for reprocessing; transforms read normalised columns for routine operations.

Ingestion does **not** handle: free-text field extraction from Reddit/Telegram, quality scoring, stale classification, or cross-source deduplication — those belong to the Transform Layer.

### Post-ingest chaining

Each ingestion script calls `run_post_ingest_transforms()` (listings) or `run_post_pulse_transforms()` (Pulse) at the end of `main()` after a successful run. This chains fast-path transforms without a separate orchestrator.

## Storage Layer

All data lives in **Supabase Postgres**.

### Reference tables (seeded once)

- **`localities`** — ~49 Bangalore localities with lat/long centroids, coverage radius, name aliases, zone (North/South/East/West/Central), and `is_active` flag.
- **`feed_topics`** — Pulse topic taxonomy: `water`, `infra`, `rent`, `commute`, `safety`, `vibe`.

### Listings stream

- **`listings`** — Unified listings table. All sources upsert here. Lifecycle via `status` field (`active` → `stale` → `expired`). Records are never deleted. Partial index on `status = 'active'` keeps search fast.
- **`ingestion_runs`** — One row per cron execution per source: counts, duration, per-locality breakdown, errors.

### Pulse stream

- **`locality_feed`** — News articles and Reddit discussions keyed by locality. Enriched post-ingest with `canonical_topic`, `sentiment_score`, `relevance_score`, `detected_localities`.

### Nightly cache tables

Recomputed by `refresh_locality_stats()` via Supabase Cron at 2 AM UTC:

- **`locality_stats_cache`** — Median, P25, P75 rent per locality+BHK, rent trend %, median price-per-sqft.
- **`deposit_stats_cache`** — Median deposit and deposit-to-rent multiplier per BHK.

### User tables (frontend writes, RLS enforced)

- **`saved_listings`** — Saved leads with status workflow and `listing_snapshot` JSONB.
- **`saved_searches`** — Filter presets for search and alerting.
- **`user_preferences`** — Default search settings.
- **`alerts`** — Email alert configs with dedup tracking.
- **`search_logs`** — Anonymous and authenticated search activity.

### Curated tables (transform output)

- **`listings_curated`** — Search-facing listings with quality scores, dedup groups, anomaly flags, Gemini extraction fields.
- **`feed_curated`** — Pulse-facing feed with featured/editor fields, trending flags.

## Listing Lifecycle

Every listing follows a 3-state machine driven by `consecutive_misses`:

| Event | Effect |
|-------|--------|
| Seen in scrape | `last_seen_at = NOW()`, `consecutive_misses = 0`, `status = active` |
| Absent 1 cycle | `consecutive_misses += 1` |
| Absent 2 cycles | `status = stale` |
| Absent 7 days | `status = expired` |
| Stale reappears | Reverts to `active` |

Two consecutive misses (not one) before stale reduces false positives from partial scrapes. Only `active` listings appear in search. Stale/expired rows are kept for trend analysis and My Hub snapshots.

Stale marking runs in the Transform Layer using `ingestion_runs.started_at` as the cycle boundary — not inside ingestion scripts — to avoid marking listings stale when a scraper times out mid-run.

## Transform Layer

Sits between Raw and Curated layers. All jobs are idempotent upserts.

### Fast path (end of each ingestion run)

**Listings** via `run_post_ingest_transforms(source, started_at)`:

- Stale marking (all sources)
- Fuzzy locality matching (Reddit/Telegram only — rapidfuzz)
- Listing filter + Gemini structured extraction (Reddit/Telegram only)

**Pulse** via `run_post_pulse_transforms(source)`:

- Gemini tagging (category, topic, sentiment, locality NER, relevance)
- Category filter (drops listing/flatmate/spam)
- News dedup (>85% title similarity)

### Slow path (nightly, 2:00–3:00 AM UTC)

| Job | Schedule | Host |
|-----|----------|------|
| `refresh_locality_stats()` | 2:00 AM UTC | Supabase Cron |
| Quality rescoring (4 dimensions) | 2:30 AM UTC | Railway Cron |
| Cross-source deduplication | 2:45 AM UTC | Railway Cron |
| Rent anomaly flagging | 2:45 AM UTC | Railway Cron |
| Trend detection (Pulse) | 3:00 AM UTC | Railway Cron |
| Editor / Curator agent (Gemini Flash) | 3:00 AM UTC | Railway Cron |
| Pipeline health check | Hourly | Railway Cron |

### Quality score (4 dimensions)

Weighted composite varying by source:

| Dimension | NoBroker / Housing | Reddit / Telegram |
|-----------|-------------------|-------------------|
| Price competitiveness | 35 | 30 |
| Locality sentiment | 30 | 20 |
| Listing detail | 20 | 20 |
| Freshness | 15 | 30 |

Freshness uses exponential decay: `max_points × e^(-0.1 × age_in_days)`.

### Cross-source deduplication

Matches duplicates when all five criteria hold: same locality, same BHK, rent within 5%, area within 30 sqft, and address token overlap. Canonical listing = highest `quality_score`. Search hides non-canonical via `(duplicate_group_id IS NULL OR id = duplicate_group_id)`.

### Pulse editor agent

Daily Gemini Flash job ranks the top neighbourhood posts from the last 24 hours (`relevance_score > 0.6`, category discussion/news). Writes `editor_rank`, `editor_note`, and `featured = true`. Uses ranking (not absolute scoring) for consistency.

## AI / ML Pipeline

| Task | Model |
|------|-------|
| Reddit/Telegram listing filter + field extraction | Gemini Flash Lite |
| Pulse tagging (5 tasks in one batch) | Gemini Flash Lite |
| Editor/curator agent | Gemini Flash |
| Locality fuzzy match | rapidfuzz (rule-based) |
| Trend detection | SQL counting |
| Gemini API outage fallback | Claude Haiku (one retry) |

Malformed Gemini JSON gets `gemini_fallback = true` with neutral defaults; a nightly job re-processes fallback rows.

## API Layer

Flask (`backend/app.py`) is the data access layer for listings, Pulse, locality stats, flags, views, alerts, and ops endpoints. User CRUD for saved data goes direct to Supabase JS with RLS.

### Listings

| Endpoint | Purpose |
|----------|---------|
| `GET /api/search` | Main search from `listings_curated` |
| `GET /api/search/new` | Poll for listings newer than `since` (My Hub alerts) |
| `GET /api/listing/<id>` | Single listing detail |

### Pulse

| Endpoint | Purpose |
|----------|---------|
| `GET /api/pulse/feed` | Curated feed with featured posts first |
| `GET /api/pulse/topics` | Topic slugs with counts and avg sentiment |
| `GET /api/pulse/trending` | Trending topics by `trending_score` |
| `GET /api/pulse/locality/<locality>` | Locality sentiment summary |
| `GET /api/pulse/feed-for-locality/<locality>` | Posts + topic counts per locality |
| `GET /api/pulse/rent-overview` | All locality rent stats |

### Locality & stats

| Endpoint | Purpose |
|----------|---------|
| `GET /api/localities` | Reference locality data |
| `GET /api/locality-stats/<locality>` | Rent + deposit stats from cache |
| `GET /api/locality-stats-all` | All locality stats + deposit benchmarks |
| `GET /api/locality-image/<locality>` | Hero image for locality |

### User & moderation

| Endpoint | Purpose |
|----------|---------|
| `POST /api/alerts` | Create email alert |
| `GET /api/alerts/check` | Cron: poll alerts, send emails |
| `POST /api/flags` | Report listing |
| `POST /api/listing-views` | Log listing view |

### Ops (admin)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Liveness |
| `GET /api/pipeline-status` | Ingestion + transform health |
| `GET /api/ingestion/status` | Listing counts by source |
| `GET /api/stats` | PostHog analytics (token-protected) |

## Deployment Topology

| Component | Host |
|-----------|------|
| React PWA | Vercel (`frontend/`) |
| Flask API | Railway (`backend/`, Gunicorn via Procfile) |
| Postgres + Auth + RLS + pg_cron | Supabase |
| SQLite read replica | Railway backend (`nestiq_replica_v2.db`, WAL, synced from Supabase) |
| Non-Reddit ingestion + transforms | Railway Cron |
| Reddit ingestion + Pulse Reddit scrape | Local macOS crontab |
| Several ingestion jobs | GitHub Actions workflows |
| Email | Resend |

Environment variables are documented in `backend/.env.example`. No secrets belong in RAG docs.

## Observability

Two audit tables:

- **`ingestion_runs`** — per-source ingest cycles
- **`transform_runs`** — per-transform-job cycles with Gemini call/fallback counts

Hourly `check_health.py` detects silent ingestion sources and elevated Gemini fallback rates. An admin `/health` page shows ingestion grid, transform grid, Gemini health, and listing status breakdown.

Record-level flags `gemini_tagged` and `gemini_fallback` on curated tables identify rows needing re-processing.
