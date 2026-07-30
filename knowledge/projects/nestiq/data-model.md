---
id: nestiq
name: NestIQ
slug: nestiq
file: data-model
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
  - architecture.md
  - technical-decisions.md
  - faq.md
  - media.md
updated_at: 2026-06-19
---

# NestIQ — Data Model

## Schema Layers

NestIQ Postgres on Supabase is organised in four logical layers:

| Layer | Purpose | Key tables |
|-------|---------|------------|
| Reference | Static config | `localities`, `feed_topics` |
| Raw | Ingested source data | `listings`, `locality_feed`, `ingestion_runs` |
| Curated | Transform output for API reads | `listings_curated`, `feed_curated` |
| User | Auth-scoped frontend writes | `saved_listings`, `saved_searches`, `user_preferences`, `search_logs`, `alerts` |

A SQLite read replica (`nestiq_replica_v2.db`, 10 tables, WAL mode) mirrors curated listing data locally on Railway for faster API reads. The Flask backend syncs from Supabase on a schedule (~40 successful syncs per 24 hours).

Listings are never deleted from the raw layer. Lifecycle is tracked via `status` (`active` → `stale` → `expired`). Search reads only `active` rows from `listings_curated`.

## Listing Sources

The `listings.source` column identifies the ingestion origin. Eight sources are active in production:

| Source value | Platform | Notes |
|--------------|----------|-------|
| `nobroker` | NoBroker | Owner-listing platform |
| `housing` | Housing.com | Broker/owner listings |
| `99acres` | 99acres | Active production source |
| `reddit` | Reddit | Housing subreddits; scraped locally |
| `telegram` | Telegram | MTProto channel posts |
| `zolo` | Zolo | PG/coliving |
| `colive` | Colive | PG/coliving |
| `stanza` | Stanza | PG/coliving; active production source |

Unique constraint on listings: `(source, source_id)`.

## Core Entity — `listings`

The unified raw listings table. All sources upsert into one schema.

### Identity and lifecycle

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL | Primary key |
| `source` | TEXT | Ingestion source (see table above) |
| `source_id` | TEXT | Platform-native listing ID |
| `source_url` | TEXT | Link to original post/listing |
| `status` | TEXT | `active`, `stale`, or `expired` |
| `first_seen_at` | TIMESTAMPTZ | First ingestion timestamp |
| `last_seen_at` | TIMESTAMPTZ | Most recent sighting in a scrape |
| `consecutive_misses` | INTEGER | Missed scrape cycles (drives stale logic) |
| `marked_stale_at` | TIMESTAMPTZ | When status became stale |

### Listing attributes

| Column | Type | Description |
|--------|------|-------------|
| `title`, `body` | TEXT | Display text |
| `bhk` | TEXT | Canonical: `1 BHK`, `2 BHK`, `3 BHK`, `Studio/1RK` |
| `property_type` | TEXT | Flat, PG, etc. |
| `furnishing` | TEXT | `Semi Furnished`, `Fully Furnished`, `Unfurnished` |
| `rent`, `deposit`, `maintenance` | INTEGER | Rupee amounts (integer ₹) |
| `locality` | TEXT | Matched Bangalore locality name |
| `address` | TEXT | Free-text address |
| `latitude`, `longitude` | DOUBLE | Geo coordinates |
| `area_sqft` | INTEGER | Built-up area |
| `amenities` | TEXT[] | Amenity tags |
| `contact_phone`, `contact_name` | TEXT | Owner contact |
| `is_flatmate`, `is_broker` | BOOLEAN | Listing type flags |
| `thumbnail_url` | TEXT | Preview image |
| `posted_at`, `scraped_at` | TIMESTAMPTZ | Source post time vs ingest time |

### Deduplication and raw storage

| Column | Type | Description |
|--------|------|-------------|
| `duplicate_group_id` | BIGINT | Points to canonical listing in a cross-source duplicate group |
| `raw_payload` | JSONB | Original API response for reprocessing |
| `quality_score` | INTEGER | Legacy ingest-time score; superseded by curated layer |

Partial index `idx_listings_active_search` on `(status, locality, bhk, rent) WHERE status = 'active'` powers search.

## Curated Entity — `listings_curated`

Extends `listings` with transform-layer enrichments. The Flask `/api/search` endpoint reads from here via JOIN.

| Column | Description |
|--------|-------------|
| `quality_score` | Composite 0–100 score |
| `price_competitiveness_score` | Dimension 2 sub-score |
| `locality_sentiment_score` | Dimension 3 sub-score |
| `freshness_score` | Dimension 4 sub-score |
| `detail_score` | Dimension 1 sub-score |
| `price_anomaly` | Rent > 2 SD from locality+BHK median |
| `is_per_room` | Per-head rent in shared flat |
| `rent_type` | `whole`, `per_room`, or `unknown` |
| `extracted_bhk`, `extracted_rent` | Gemini-extracted values for Reddit/Telegram |
| `is_listing` | FALSE excludes non-listing posts from search |
| `gemini_tagged` | Gemini extraction ran successfully |
| `gemini_fallback` | Gemini failed; defaults applied, pending re-process |

Search filter: `(duplicate_group_id IS NULL OR id = duplicate_group_id) AND is_listing != FALSE AND status = 'active'`.

## Pulse Entities

### `locality_feed` (raw)

News articles and community discussions keyed by locality.

| Column | Description |
|--------|-------------|
| `source` | `news`, `reddit`, `reddit_discussions`, `google_news_rss`, `citizen_matters` |
| `source_id` | MD5 of URL (news) or post ID (social) |
| `locality` | Primary locality |
| `title`, `body`, `url`, `author` | Content fields |
| `engagement` | Upvotes or engagement proxy |
| `canonical_topic` | Mapped to `feed_topics` slug |
| `sentiment_score` | Float −1.0 to 1.0 |
| `relevance_score` | Float 0.0 to 1.0 |
| `detected_localities` | Array of Bangalore neighbourhoods |

Unique constraint: `(source, source_id)`.

### `feed_curated` (curated)

Filtered Pulse output. Only `discussion` and `news` categories advance here.

| Column | Description |
|--------|-------------|
| `feed_id` | FK to `locality_feed.id` |
| `featured` | Selected by daily editor agent |
| `editor_rank` | 1-indexed rank within editor shortlist |
| `editor_note` | One-sentence editorial rationale |
| `is_trending` | Topic spike detected |
| `trending_score` | Spike ratio from trend detection |
| `gemini_tagged`, `gemini_fallback` | NLP pipeline status |

### `feed_topics` (reference)

Canonical topic taxonomy for Pulse: `water`, `infra`, `rent`, `commute`, `safety`, `vibe`.

## Reference — `localities`

~49 Bangalore localities. Seeded once, updated manually.

| Column | Description |
|--------|-------------|
| `name` | Canonical locality name (unique) |
| `latitude`, `longitude` | Centroid coordinates |
| `radius_km` | Coverage radius (default 2.0 km) |
| `aliases` | TEXT[] for fuzzy ingestion matching |
| `also_include` | TEXT[] expanded locality group |
| `zone` | North / South / East / West / Central |
| `is_active` | Whether locality is tracked |

## Stats Cache Tables

Nightly recomputed by `refresh_locality_stats()` via Supabase Cron.

### `locality_stats_cache`

| Column | Description |
|--------|-------------|
| `locality`, `bhk` | Composite key |
| `median_rent`, `p25_rent`, `p75_rent` | Rent percentiles |
| `listing_count` | Sample size (requires ≥15 listings) |
| `rent_trend_pct` | % change vs prior 30-day window |
| `median_price_per_sqft` | Rent/area median where area available |

### `deposit_stats_cache`

Median deposit and deposit-to-rent multiplier per BHK type.

## Pipeline Observability

### `ingestion_runs`

One row per cron execution per source.

| Column | Description |
|--------|-------------|
| `source` | e.g. `nobroker`, `99acres`, `stanza`, `reddit_discussions` |
| `status` | `success`, `partial`, `failed`, `running` |
| `total_fetched`, `total_new`, `total_updated`, `total_stale`, `total_errors` | Counters |
| `locality_counts` | JSONB per-locality breakdown |
| `duration_ms` | Runtime |
| `started_at` | Used as stale-marking cycle boundary |

### `transform_runs`

One row per transform job per cycle.

| Column | Description |
|--------|-------------|
| `job_name` | e.g. `stale_marking`, `quality_rescoring`, `editor_agent` |
| `gemini_calls`, `gemini_fallback_count` | API usage tracking |
| `records_processed`, `records_failed`, `records_skipped` | Throughput |
| `metadata` | JSONB job-specific stats |

## User Data Tables

All user tables use Supabase Row Level Security (`auth.uid() = user_id`).

### `saved_listings`

| Column | Description |
|--------|-------------|
| `listing_id` | TEXT composite ID (`source_sourceid`) |
| `status` | `interested` → `contacted` → `visited` → `rejected` |
| `listing_snapshot` | JSONB frozen at save time |
| `notes` | User notes |

### `saved_searches`

Filter presets: `location`, `bhk`, `budget`, `keywords`, `sources`, `min_quality`, `last_run_at`.

### `user_preferences`

Default search form values: `default_location`, `default_bhk`, `default_budget`.

### `alerts`

Email alert configs: `email`, `locality`, `bhk`, `budget_max`, `keywords`, `sources`, `last_sent_ids` JSONB.

### `search_logs`

Anonymous and authenticated search events with locality + filter JSONB.

## Community Signals

### `listing_flags`

Renter reports (fake, already rented, wrong price, etc.). Soft signal only — never affects search ranking. One active flag per device per listing.

### `listing_views` + `listing_view_stats`

Detail-page view tracking with 24-hour device dedupe. `listing_view_stats` holds precomputed `total_views` per listing for card display.

## Entity Relationships

```
localities ─────────────────────────────────────────┐
                                                    │
listings ──→ listings_curated ←── transform_runs   │
    ↑                                               │
ingestion_runs                                      │
                                                    │
locality_feed ──→ feed_curated ←── feed_topics       │
                                                    │
saved_listings.listing_id ──→ listings (status)     │
locality_stats_cache ←── listings (aggregated)      │
```

Raw tables are never mutated by transforms. Curated tables are fully re-derivable from raw by re-running transform jobs.

## Current Data Volumes

As of June 2026 production metrics:

| Metric | Value |
|--------|-------|
| Active listings | 2,437 |
| Total listings (all statuses) | 21,079 |
| Active sources | 8 |
| SQLite replica rows | 43,027 |
| SQLite replica size | 96.5 MB |

### Active listings by source

| Source | Active | Stale | Expired | Total |
|--------|--------|-------|---------|-------|
| 99acres | 608 | 608 | 7,057 | 8,273 |
| Housing | 693 | 794 | 5,816 | 7,303 |
| NoBroker | 618 | 239 | 2,075 | 2,932 |
| Reddit | 71 | 182 | 779 | 1,032 |
| Zolo | 169 | 0 | 1 | 170 |
| Colive | 121 | 3 | 12 | 136 |
| Stanza | 86 | 0 | 0 | 86 |
| Telegram | 71 | 26 | 502 | 599 |
