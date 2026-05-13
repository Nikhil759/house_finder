# Data Pipeline Architecture

This document describes the end-to-end data pipeline architecture as the desired target state.

---

## 1. Ingestion Layer

The Ingestion layer is responsible for gathering raw data from our defined external platforms. Ingestion is split into two main data streams: **Pulse** and **Listings**.

### Data Sources & Streams

#### A. Pulse
The Pulse stream gathers general market sentiment, news, and community discussions. It pulls data from 2 sources:
- **Reddit API**
- **Google News API**

#### B. Listings
The Listings stream gathers specific real estate listings and availability. It aggregates data from 4 sources (all via APIs):
- **NoBroker API**
- **Housing.com API**
- **Telegram API**
- **Reddit API**

### Orchestration & Compute

Each source has its own **dedicated cron job** running on an independent schedule. A failure in one source does not affect others.

- **Schedules:**

  | Stream   | Source      | Script                         | Schedule                       | Cron Host     |
  |----------|-------------|--------------------------------|--------------------------------|---------------|
  | Listings | NoBroker    | `ingest_nobroker.py`           | Every 3 hours (`0 */3 * * *`)  | Railway Cron  |
  | Listings | Housing.com | `ingest_housing.py`            | Every 3 hours (`0 */3 * * *`)  | Railway Cron  |
  | Listings | Telegram    | `ingest_telegram.py`           | Every 3 hours (`0 */3 * * *`)  | Railway Cron  |
  | Listings | Reddit      | `ingest_reddit.py`             | Every 6 hours (`0 */6 * * *`)  | Local crontab |
  | Listings | Zolo (PG)   | `ingest_zolo.py`               | Every 12 hours (`0 */12 * * *`)| Railway Cron  |
  | Listings | Colive (PG) | `ingest_colive.py`             | Every 12 hours (`0 */12 * * *`)| Railway Cron  |
  | Pulse    | Reddit      | `scrape_reddit_discussions.py` | Every 6 hours (`0 */6 * * *`)  | Local crontab |
  | Pulse    | Google News | `scrape_news.py`               | Every 6 hours (`0 */6 * * *`)  | Railway Cron  |

- **Orchestration:** Railway Cron for 6 non-Reddit jobs, local macOS crontab for 2 Reddit jobs (Reddit blocks Railway IP ranges). No external orchestrator (Prefect/Airflow) — at current scale, cron + the `ingestion_runs` audit table provides sufficient scheduling and observability.
- **Compute Provider:** **Railway** provisions the compute for all backend scripts except Reddit scraping.
- **Fast-path transforms:** Each ingestion script calls `run_post_ingest_transforms()` (or `run_post_pulse_transforms()` for Pulse scripts) at the end of its `main()` function after a successful ingest. This chains transforms to ingestion without needing a separate orchestrator for dependency management.

### Raw JSON → Structured: The Dual-Write Pattern

Every ingestion script normalizes source data before writing to the database. Each source produces a `StandardListing` object (validated by Pydantic) which handles:

- **Price coercion:** Strips `₹`, commas, converts to integer. Detects annual quotes (₹1.5L–18L) and auto-divides by 12. Nulls out garbage values (< ₹2k or > ₹18L).
- **BHK normalization:** `"2BHK"`, `"2 bhk"`, `"2-BHK"` → `"2 BHK"`. `"studio"`, `"1RK"` → `"Studio/1RK"`.
- **Furnishing normalization:** Any variant of semi/fully furnished → canonical `"Semi Furnished"` / `"Fully Furnished"` / `"Unfurnished"`.
- **Timestamp coercion:** Unix timestamps (ms or s), ISO strings → UTC datetime.
- **Deposit sanity:** Nulls below ₹1k or above ₹50L.

Both the normalized columns **and** the original raw API response (`raw_payload` JSONB) are written to the same row. This dual-write pattern means: the raw layer is the source of truth for reprocessing, while the normalized columns serve immediate query needs. The Transform Layer reads from the normalized columns — not from JSONB — for all routine operations.

**What ingestion does NOT normalize** (left for the Transform Layer): structured field extraction from free-text Reddit/Telegram posts, quality scoring, stale classification, and deduplication.

### Rate Limiting & Resilience

To prevent session drops and IP bans, the ingestion pipelines use several proactive strategies:

- **Randomized Throttling**: The NoBroker and Housing.com pipelines inject random sleep delays (`random.uniform(2, 4)` seconds) between locality fetches to avoid rate-limiting triggers.
- **Session & Header Spoofing**: Scripts simulate genuine traffic by cycling realistic `User-Agent` strings and maintaining comprehensive `Requests.Session` objects with valid Origins and Referers.
- **Graceful Fallbacks**:
  - **Reddit**: Employs a robust 3-tier fallback execution:
    1. Attempts the **Reddit OAuth API** first.
    2. Falls back to **Public Reddit `.json`** endpoints with browser traffic simulation.
    3. Final fallback relies on the **PullPush API**.
  - **Housing.com**: Rapidly resolves geo-hashes via a hardcoded in-memory map. If a locality is unknown, it falls back to the native autocomplete suggestion API.
  - **Geocoding**: If Google Maps geocoding fails, coordinates automatically fall back to static locality centroids.

---

## 2. Storage Layer (Raw Layer)

All ingested data lands in a **PostgreSQL database** hosted by **Supabase**.

The initial landing zone is the **Raw Layer**, where original source API responses are captured unchanged in **JSON format** within Postgres alongside partially normalized relational columns.

### Raw Layer Tables

Tables are grouped by how they are populated.

#### Static Tables — One-Time Seed

Pre-loaded once with reference data. Updated manually when underlying configuration changes.

- **`localities`**: The canonical reference table for all tracked Bangalore localities (~49 entries). Each row contains the locality name, lat/long centroid, coverage radius, name aliases (for fuzzy matching during ingestion), zone classification (North/South/East/West/Central), and an `is_active` flag.
- **`feed_topics`**: The canonical topic taxonomy used by the Pulse tagger. Contains 6 topic slugs (`water`, `infra`, `rent`, `commute`, `safety`, `vibe`) with human-readable labels and keyword descriptions.

---

#### Listings Stream — Regularly Ingested

Written to on every Listings pipeline cron run.

- **`listings`**: The core unified listings table. All 4 sources (NoBroker, Housing.com, Telegram, Reddit) upsert into this single table. Columns are partially normalized (`bhk`, `rent`, `locality`, `furnishing`, etc.) but the full original API response is preserved in `raw_payload` (JSONB) for reprocessing. Records are never deleted — lifecycle is tracked via a `status` field (`active` → `stale` → `expired`). A partial index on `status = 'active'` ensures search queries only scan active rows regardless of total table size.
- **`ingestion_runs`**: Pipeline observability table. One row is written per cron execution per source, tracking `total_fetched`, `total_new`, `total_updated`, `total_errors`, `duration_ms`, and a per-locality breakdown in `locality_counts` (JSONB).

---

#### Pulse Stream — Regularly Ingested

Written to on every Pulse pipeline cron run.

- **`locality_feed`**: Stores news articles (Google News) and community discussions (Reddit) keyed by locality. Upserted every 6 hours. After ingestion, the Gemini tagger enriches each row with `canonical_topic`, `sentiment_score`, `relevance_score`, and `detected_localities`.

---

#### Derived / Cache Tables — Nightly Computed

Not written to by ingestion. Recomputed nightly by the `refresh_locality_stats()` Postgres function, triggered via **Supabase Cron**. Aggregates data from the `listings` table.

- **`locality_stats_cache`**: Median, P25, and P75 rent per locality+BHK combination, plus a `rent_trend_pct` column (% change vs. prior 30-day window). Powers the Locality Guide and Locality Detail pages.
- **`deposit_stats_cache`**: Median deposit and average deposit-to-rent multiplier per BHK type. Refreshed in the same nightly job.

---

#### User Data Tables — Event-Driven (Frontend Writes)

Written to by user actions via Supabase JS on the frontend. All tables have Row Level Security (RLS) enforced.

- **`saved_listings`**: A user's saved listings with a status workflow (`interested` → `contacted` → `visited` → `rejected`) and optional notes. Stores a `listing_snapshot` (JSONB) at save time so the listing remains visible even after it goes stale. The My Hub page cross-references `listings.status` to surface a stale badge when a saved listing is no longer active.
- **`saved_searches`**: Saved filter presets (location, BHK, budget, keywords, sources) with a `last_run_at` timestamp. Also used for alerting.
- **`user_preferences`**: Per-user default search settings (location, BHK, budget). Pre-fills the search form on login.
- **`alerts`**: Email alert configurations tied to a filter set. Tracks `last_triggered` and `last_sent_ids` to avoid duplicate notifications.
- **`search_logs`**: Anonymous and authenticated search activity log. Captures locality + filter JSONB per search event. Used for product analytics and to auto-save frequently searched localities into `saved_searches`.

---

## 3. Business Logic

### Listing Lifecycle — 3-State Machine

Every listing moves through three states: `active` → `stale` → `expired`, driven by a `consecutive_misses` counter.

| Event | What happens |
|---|---|
| Listing seen in a scrape cycle | `last_seen_at = NOW()`, `consecutive_misses = 0`, `status = 'active'` |
| Listing absent for 1 cycle | `consecutive_misses += 1` |
| Listing absent for 2 cycles | `status = 'stale'` |
| Listing absent for 7 days | `status = 'expired'` |
| Stale listing reappears | Automatically reverts to `active`, `consecutive_misses = 0` |

**2 misses before stale (not 1):** A single missed cycle can mean the scrape job hit a transient rate limit or API timeout — not that the listing is gone. Two consecutive misses require the listing to be absent across two independent runs, making false stale-marking extremely unlikely.

**Only `active` listings appear in search.** Stale and expired records are retained permanently for: long-term rental trend analysis, locality rent percentile calculations (which aggregate over `active + stale` for a larger sample), and My Hub saved listings (which show a stale badge by cross-referencing `listings.status`).

**Note:** The stale-marking logic (`mark_stale()`) is a classification concern, not an ingestion concern. In the target architecture it belongs in the Transform Layer, where it reads the `started_at` timestamp from `ingestion_runs` to determine the correct cycle boundary — decoupling it from the ingestion script's runtime.

---

### Cross-Source Deduplication

The same flat frequently appears on multiple platforms simultaneously. The dedup job detects these cross-source duplicates and groups them under a shared `duplicate_group_id` on the `listings` table. The canonical listing (highest `quality_score`) has `id = duplicate_group_id`; non-canonical duplicates point to it. Search suppresses non-canonical listings via `(duplicate_group_id IS NULL OR id = duplicate_group_id)`.

Deduplication logic and scheduling is covered in the Transform Layer documentation.

---

## 4. Design Decisions

### Orchestration — Cron over Prefect/Airflow

No external orchestrator (Prefect, Airflow) is used. At current scale — 6 ingestion scripts and a handful of transform jobs — the operational overhead of maintaining an orchestration platform (additional always-on processes, metadata databases, paid plan requirements) outweighs its benefits. Cron scheduling (Railway Cron + local crontab) combined with the `ingestion_runs` and `transform_runs` Postgres tables provides sufficient scheduling, run history, and failure visibility.

**Dependency chaining** is handled by direct function calls: each ingestion script calls `run_post_ingest_transforms()` or `run_post_pulse_transforms()` at the end of its `main()` function. This guarantees transforms run immediately after ingestion without needing inter-process signalling or a scheduler DAG.

**Reddit flows run locally, not on Railway.** Reddit actively blocks requests originating from known cloud provider IP ranges (AWS/GCP), which Railway runs on. All 3 fallback tiers (OAuth API → public JSON → PullPush) still originate from the same datacenter IP and are subject to this block. The Reddit scrapers (`ingest_reddit.py`, `scrape_reddit_discussions.py`) must run from a residential IP — practically, a local machine via macOS crontab. Both Railway and local runs write to the same `ingestion_runs` and `transform_runs` tables, so observability is unified regardless of where the job physically executes.

### Storage — Supabase + Railway

**Supabase** was chosen as the Postgres host because it bundles the database, Auth, Row Level Security, and a JavaScript client library in one platform. This eliminates the need to build or host an authentication service, a separate API layer for user data, or a connection pooler — the frontend reads and writes user data directly via the Supabase JS client with RLS enforcing per-user data isolation. Supabase Cron is also used for the nightly `refresh_locality_stats()` job, keeping internal Postgres maintenance within the same platform.

**Railway** was chosen as the compute provider for backend ingestion scripts because it supports always-on Python processes with environment variable management, easy deploys from a git repo, and low operational overhead. It is not used for the Reddit scrapers due to the IP blocking issue described above.

### Caching — No External Cache Layer Needed

An external cache (Redis or similar) was evaluated and ruled out for the current scale. The reasons:

- **Listing search queries** hit Postgres directly. With ~4,600 total listings and a partial index on `status = 'active'` covering only the ~1,500 active rows, search queries return in milliseconds. The bottleneck is network round-trip to Supabase, not query execution time.
- **Locality stats** (median rent, percentiles) are expensive aggregations but are pre-computed nightly into `locality_stats_cache` and `deposit_stats_cache`. The frontend reads these as a simple `SELECT *` — they are already as fast as any cache would be.
- A Redis layer would add a cache invalidation problem: listings change status every 3–6 hours on every cron run. Keeping a cache in sync with Postgres would require either full cache rebuilds after every ingestion run or surgical per-listing updates — both add complexity that isn't justified at this scale.

The right scaling path if read pressure increases: enable a **Supabase read replica** (available on Pro plan), which routes all frontend reads to a physically separate Postgres server with its own CPU and connection pool, eliminating read/write contention without any application-level cache invalidation logic.

---

## 5. Transform Layer

### Overview & Data Flow

The Transform Layer sits between the Raw Layer and the Curated Layer. It reads from the raw `listings` and `locality_feed` tables, applies classification, enrichment, normalization, and scoring transforms, and writes results to a separate **Curated DB** (also in Supabase Postgres). The frontend and backend API read exclusively from the Curated Layer — never from raw tables directly.

```
Raw Layer (listings, locality_feed)
        ↓
  Transform Layer (Railway + local)
   ├── Script-based transforms (Python)
   └── NLP-based transforms (Gemini Flash Lite / Gemini Flash)
        ↓
  Curated Layer (listings_curated, feed_curated)
        ↓
  Backend API → Frontend
```

All transform jobs are idempotent — safe to re-run on the same data without side effects. Writes use `INSERT ... ON CONFLICT DO UPDATE` (upserts), never delete-then-insert, so a partial run leaves the curated layer in a valid degraded state that the next run will complete.

### Job Scheduling — Hybrid Approach

Transform jobs are split into two paths based on how time-sensitive they are:

**Fast Path — Called at the end of each ingestion script's `main()`**

These run per-cycle because they affect search correctness immediately or depend on the specific run's `started_at` timestamp. No separate scheduler needed — the dependency chain is a direct function call inside the ingestion script.

*Listings (via `run_post_ingest_transforms(source, started_at)`:*

| Job | All Sources | Reddit/Telegram Only |
|---|---|---|
| Stale marking | ✓ | |
| Fuzzy locality matching | | ✓ |
| Listing filter + Gemini extraction | | ✓ |

*Pulse (via `run_post_pulse_transforms(source)`:*

| Job | All Sources | News Only |
|---|---|---|
| Gemini tagging (category, topic, sentiment, locality NER, relevance) | ✓ | |
| Category filter | ✓ | |
| News dedup (>85% title similarity) | | ✓ |

**Slow Path — Scheduled Daily (2:00–3:00 AM UTC via Railway Cron + Supabase Cron)**

These depend on aggregated data from `locality_stats_cache` or benefit from seeing all sources together.

| Job | Schedule | Cron Host |
|---|---|---|
| `refresh_locality_stats()` | 2:00 AM UTC | Supabase Cron |
| Full quality rescoring (all 4 dimensions) | 2:30 AM UTC | Railway Cron |
| Cross-source deduplication | 2:45 AM UTC | Railway Cron |
| Rent anomaly flagging | 2:45 AM UTC | Railway Cron |
| Trend detection (Pulse) | 3:00 AM UTC | Railway Cron |
| Editor / Curator Agent (Gemini Flash) | 3:00 AM UTC | Railway Cron |
| Pipeline health check | Every hour | Railway Cron |

---

### Listings Transformations

#### Script-Based

**1. Locality Extraction & Fuzzy Matching**
The ingestion layer matches locality names using an exact alias table lookup. The transform layer applies a second pass using **fuzzy string matching** (rapidfuzz library) to catch misspellings not in the alias table (e.g. "koramanagala" → "Koramangala", "maratahalli" → "Marathahalli"). This runs in-process, zero API cost.

**2. Stale Marking**
Reads `started_at` from `ingestion_runs` for the latest completed run per source, then applies the 3-pass stale logic:
- `consecutive_misses += 1` for listings not seen since `started_at`
- `status = 'stale'` at 2 consecutive misses
- `status = 'expired'` after 7 days without being seen

Decoupled from the ingestion script runtime — a partial scrape does not trigger premature stale-marking.

**3. Cross-Source Deduplication**
Detects the same flat listed on multiple platforms simultaneously. Runs on listings seen in the last 48 hours. Matching criteria (all 5 must hold):
1. Same locality (exact, case-insensitive)
2. Same BHK
3. Rent within 5%
4. `area_sqft` present on both sides and within 30 sqft
5. Address token check — numbered sub-location tokens must not be completely disjoint

Sets `duplicate_group_id` on matched listings. The canonical listing (highest `quality_score`) has `id = duplicate_group_id`. Non-canonical duplicates are hidden in search via `(duplicate_group_id IS NULL OR id = duplicate_group_id)`. Design principle: *conservative — better to miss a duplicate than to hide a unique listing.*

**4. Rent Anomaly Flagging**

Two distinct problems handled separately:

*Garbage values* (₹30 instead of ₹30,000): If rent is > 2 standard deviations from the locality+BHK median, flagged as `price_anomaly = true`. These listings are excluded from `locality_stats_cache` calculations to protect averages and visually flagged in the UI.

*Per-room vs whole-flat pricing* (common in Telegram posts showing per-head rent for a shared 2BHK): A regex pre-filter catches obvious signals ("per head", "per person", "sharing basis", "each person"). For ambiguous cases, the Gemini structured extraction call (see NLP section) explicitly extracts `rent_type: "whole" | "per_room" | "unknown"`. Listings with `rent_type = "per_room"` are flagged `is_per_room = true`, excluded from locality median calculations, and labelled separately in the UI — they are not directly comparable to whole-flat listings.

---

#### NLP-Based

**1. Reddit/Telegram Listing Filter + Structured Extraction (Gemini Flash Lite)**
Reddit and Telegram scrapes inevitably include non-listing posts (discussions, "looking for flatmate" posts, random neighbourhood commentary). A regex pre-filter first drops obvious non-listings (posts with "looking for", "need flatmate", "seeking" in the title). For the remainder, a single Gemini Flash Lite batch call simultaneously:
- Determines `is_listing: true/false` — is this post genuinely offering a property for rent?
- Extracts structured fields from `title + body`: BHK, rent, deposit, furnishing, area_sqft, amenities, contact phone, society name, `rent_type`

Posts where `is_listing = false` OR both rent and BHK are NULL after extraction are excluded from `listings_curated`. Batches up to 200 posts per API call. At current scale: ~$3-4/year.

---

### Listings Quality Score

Computed by the Transform Layer (not at ingest time) because dimensions 2 and 3 require aggregated data from `locality_stats_cache` and `locality_feed` that is not available at ingest time.

The score is a **weighted composite of 4 dimensions**, with weights varying by source:

| Dimension | NoBroker / Housing.com | Reddit / Telegram |
|---|---|---|
| Price Competitiveness | 35 | 30 |
| Locality Sentiment | 30 | 20 |
| Listing Detail | 20 | 20 |
| Freshness | 15 | 30 |
| **Total** | **100** | **100** |

**Dimension 1 — Listing Detail (0–20 / 0–20)**
Evaluates completeness of the listing record: rent present, BHK identified, locality identified, contact present, furnishing stated, deposit mentioned, area_sqft present, images present. Each field contributes proportionally. Source bonuses are removed — a detailed Reddit post can outscore a sparse NoBroker listing.

**Dimension 2 — Price Competitiveness (0–35 / 0–30)**
Compares listing price against the locality+BHK median from `locality_stats_cache`.

*When `area_sqft` is available (preferred):*
```
price_per_sqft = rent / area_sqft
competitiveness = (median_ppsf - listing_ppsf) / median_ppsf  → normalised to score
```

*When `area_sqft` is missing (fallback):*
```
competitiveness = (median_rent - listing_rent) / median_rent  → normalised to score
```

Falls back to city-wide BHK median when locality-level data has fewer than 15 listings.

**Dimension 3 — Locality Sentiment (0–30 / 0–20)**
Rolling 30-day average `sentiment_score` from `locality_feed` for the listing's locality, weighted by each post's `relevance_score`. Topic distribution also influences this: a locality with high-engagement negative `safety` posts receives a penalty. Defaults to neutral (0.5 of max) when fewer than 5 locality feed posts exist in the window.

**Dimension 4 — Freshness (0–15 / 0–30)**
Smooth exponential decay rather than step-function:
```
freshness_score = max_points × e^(-0.1 × age_in_days)
```
At day 0: full points. At 10 days: ~37% of max. At 30 days: ~5% of max. For NoBroker/Housing.com, `status = 'active'` already guarantees the listing is live, so freshness carries less weight. For Reddit/Telegram, a 3-day-old post is likely already rented — freshness is the most critical signal.

---

### Pulse Transformations

#### Script-Based

**1. Category Filter**
Posts classified as `listing`, `flatmate_search`, or `spam` by the Gemini tagger are excluded from the curated feed. Only `discussion` and `news` posts advance to the `feed_curated` table.

**2. Duplicate News Deduplication**
The Google News API often returns the same story from multiple publications. Before tagging, near-duplicate news articles (> 85% title similarity) are deduplicated — the highest-engagement version is kept, others are dropped.

**3. Trend Detection (SQL-based)**
Identifies emerging topics by comparing recent post volume against a baseline:
```
recent_count  = posts with canonical_topic T in last 72 hours
baseline_mean = 7-day rolling average daily count for topic T
spike_ratio   = recent_count / (3 × baseline_mean)  -- normalise to same window
```
A topic is flagged `is_trending = true` when `spike_ratio ≥ 2.0` AND `recent_count ≥ 5` (minimum absolute threshold to avoid noise on rarely-discussed topics). The `trending_score` column stores `spike_ratio` to allow ordering multiple trending topics by urgency. No LLM required — this is a counting problem.

---

#### NLP-Based — Gemini Flash Lite (Existing Pipeline)

A single batch call per ingestion cycle (up to 200 posts), returning structured JSON for all five tasks simultaneously:

- **Category tagging:** `discussion / news / listing / flatmate_search / spam`
- **Topic tagging:** Maps to canonical `feed_topics` slugs; auto-creates new topic slugs when a post clearly fits a new category (e.g. `"pets"`, `"pollution"`, `"parking"`)
- **Sentiment scoring:** Continuous float `-1.0` to `1.0` — not bucketed. `-1.0` = outrage/danger, `0.0` = factual/neutral, `1.0` = enthusiastic recommendation
- **Locality NER:** Array of Bangalore neighbourhood names detected in or relevant to the post. A post can belong to multiple localities.
- **Relevance scoring:** `0.0` to `1.0` — how useful is this post for understanding neighbourhood sentiment. Spam and off-topic posts score near 0.

---

#### NLP-Based — Editor / Curator Agent (Gemini Flash)

Runs once per day at 3:00 AM UTC on the best posts from the **last 24 hours** to ensure a sufficiently large and fresh pool of content.

**Selection and pre-filtering:**
1. Filter to `relevance_score > 0.6` and `category IN ('discussion', 'news')`
2. If more than 200 posts match (high-activity days), keep the top 200 by `(sentiment_score * relevance_score)` to reduce API input size
3. Exclude posts that were already `featured = true` in the previous cycle to ensure the feed doesn't repeat itself

**Editor prompt design:**
A Gemini Flash prompt acts as a "city editor" — it reads the filtered batch and **ranks** them, not scores them. Ranking is preferred because LLMs produce more consistent relative judgments than consistent absolute scores. The editor produces an ordered list of the top N posts, applying editorial criteria: surprising or actionable insights, locally specific (not generic), high-engagement signals in the post text, real neighbourhood story (not routine complaint). It also supplies a short `editor_note` (1 sentence) for each selected post explaining why it was featured (e.g. "First reports of water cuts in Whitefield this season").

Uses Gemini Flash (not Lite) because editorial judgment requires contextual reasoning.

**Output:** Writes `editor_rank` (1-indexed), `editor_note` (text), and `featured = true` to the selected posts in `feed_curated`. Also writes `editor_shortlist_size` (total count of posts the editor was given to rank from) to `pulse_feed_state` alongside `feed_refreshed_at` timestamp — the frontend uses this to show "Last updated".

---

### Error Resilience & Observability

**Transform-level failure isolation:**
- Each transform job is a separate function call. Failure in one (e.g. the editor agent) does not block others (e.g. quality rescoring, dedup) — each job has its own `try/except` that logs to `transform_runs` and continues.
- Because all writes are upserts, a partial run leaves the curated layer in a valid (degraded) state that the next full run will complete.

**Gemini failure handling:**
- Every Gemini call wraps responses in a JSON validator. If the response is malformed or times out, the record is written to the curated layer with `gemini_fallback = true` and a neutral default (e.g. `sentiment_score = null`, `category = null`).
- A separate nightly job re-processes all `gemini_fallback = true` records once the API is healthy.
- Claude Haiku (Anthropic) is wired as a one-retry fallback when Gemini Flash Lite returns an error response (not just malformed JSON — actual API errors). This covers Gemini outage windows.

**`transform_runs` table:**
Each transform job logs a row to `transform_runs` with:
- `job_name`, `started_at`, `completed_at`, `status` (`success / partial / failed`)
- `records_processed`, `records_failed`, `gemini_calls`, `gemini_fallback_count`
- `error_message` (if failed)

This table powers a custom internal dashboard and enables per-job health monitoring and Gemini fallback rate tracking.

---

### Model Selection Rationale

| Task | Model | Reason |
|---|---|---|
| Reddit/Telegram listing filter + structured extraction | Gemini Flash Lite | Single call per post for both is-listing classification and field extraction. ~$3-4/year at current scale |
| Category, topic, sentiment, locality NER, relevance (Pulse) | Gemini Flash Lite | One batch call for 5 tasks simultaneously — far cheaper than 5 separate models |
| Locality fuzzy matching | rapidfuzz (rule-based) | More reliable for Bangalore-specific names than generic NER. The `localities` alias table IS the model |
| Trend detection | SQL GROUP BY | Counting co-occurring topics in a time window — no NLP required |
| Editor / Curator agent | Gemini Flash (not Lite) | Requires genuine editorial reasoning. Lite produces mechanical, repetitive selections |
| Gemini fallback (API outage) | Claude Haiku | One retry for API errors only, not JSON parsing errors. Cost-effective at rare usage |

**Gemini stability note:** Gemini Flash Lite occasionally returns malformed JSON or inconsistent outputs. All Gemini calls include JSON schema validation with graceful fallbacks (`gemini_fallback = true`, neutral defaults). Malformed-JSON failures are handled silently within the transform job — the record gets defaults and is flagged for re-processing.

---

### Curated Layer Schema

The Transform Layer writes to separate curated tables. The frontend and API read only from these.

**`listings_curated`** — all columns from `listings`, plus:

| Column | Notes |
|---|---|
| `quality_score` | Composite score (recomputed daily) |
| `price_competitiveness_score` | Dimension 2 sub-score |
| `locality_sentiment_score` | Dimension 3 sub-score |
| `freshness_score` | Dimension 4 sub-score |
| `detail_score` | Dimension 1 sub-score |
| `price_anomaly` | Boolean — rent > 2 SD from locality+BHK median |
| `is_per_room` | Boolean — Telegram/Reddit posts advertising per-head rent |
| `rent_type` | `"whole" / "per_room" / "unknown"` — from Gemini extraction |
| `extracted_bhk`, `extracted_rent` | LLM-extracted values for Reddit/Telegram NULLs |
| `gemini_tagged` | Boolean — whether Gemini extraction ran for this row |
| `gemini_fallback` | Boolean — Gemini failed; row uses defaults/rule-based values |

**`feed_curated`** — filtered subset of `locality_feed` (only `discussion` and `news`), plus:

| Column | Notes |
|---|---|
| `featured` | Boolean — selected by editor agent |
| `editor_rank` | Integer (1-indexed) within that cycle's shortlist |
| `editor_note` | Short editorial note from Gemini Flash explaining why this post was featured |
| `is_trending` | Boolean — topic was flagged as trending by trend detection job |
| `trending_score` | Float — `spike_ratio` from trend detection; used to order trending topics |
| `gemini_tagged` | Boolean — Gemini tagger ran successfully for this row |
| `gemini_fallback` | Boolean — Gemini failed; row is tagged with defaults |

Both `listings_curated` and `feed_curated` are fully re-derivable from the raw layer at any time. If a transform bug corrupts a curated table, the raw layer is untouched and the curated table can be rebuilt from scratch by re-running all transform flows.

State that the Pulse frontend needs (last updated timestamp, trending topics) is derived on demand from `feed_curated` queries rather than a separate state table:
- `feed_refreshed_at` → `SELECT MAX(updated_at) FROM feed_curated WHERE featured = true`
- Currently trending topics → `SELECT DISTINCT canonical_topic FROM feed_curated WHERE is_trending = true`

---

### Design Decisions & Tradeoffs

**1. Hybrid scheduling over purely event-driven**
Quality rescoring and deduplication depend on aggregated data from `locality_stats_cache` (which itself runs at 2 AM) and benefit from seeing all four listing sources together. Running them per-cycle would produce inconsistent scores mid-day as sources complete at different times. The split — fast-path for time-sensitive correctness, slow-path for aggregate-dependent enrichment — avoids both stale data and premature partial results.

**2. Gemini Flash Lite as the primary NLP model (over RoBERTa / spaCy)**
RoBERTa is deterministic and free but requires hosting a model file, doesn't generalise to extraction tasks, and doesn't handle Indian English well out of the box. spaCy PhraseMatcher is fast but needs a manually maintained Bangalore entity dictionary. Gemini Flash Lite handles all classification, extraction, sentiment, and NER tasks in a single API call at ~$3–4/year at current scale. The cost-to-complexity ratio strongly favours Gemini for now; RoBERTa remains a considered fallback if API instability becomes a recurring problem.

**3. Gemini Flash (not Lite) for the editor agent**
Flash Lite produces mechanically repetitive shortlists — it tends to pick the highest-upvote posts regardless of narrative value. The editor agent's entire purpose is contextual editorial judgment: distinguishing a genuinely insightful community post from a routine complaint. That requires Flash. The higher per-call cost is justified because the editor runs once daily on a small batch, not per-cycle on thousands of records.

**4. Ranking over scoring for the editor agent**
LLMs produce more stable relative judgments ("A is better than B") than stable absolute scores ("A = 0.87"). A score that shifts by ±0.2 between runs with identical input is misleading; a rank that shifts is expected and natural. Ranking also forces the model to make explicit tradeoffs within the batch rather than inflating all scores.

**5. Claude Haiku as API-error fallback only (not for malformed JSON)**
Malformed JSON from Gemini is handled silently within the transform job — the record gets `gemini_fallback = true` and neutral defaults, and is re-processed the next day. Claude Haiku is only invoked when Gemini's API itself returns an error response (rate limit, outage). This keeps vendor dependency rare and cost near-zero while still covering the outage scenario.

**6. No spaCy for entity extraction**
Gemini already extracts locality names as part of the Pulse tagging batch call. A spaCy PhraseMatcher for Bangalore-specific entities (metro stations, roads, BBMP/BWSSB) would require maintaining a custom entity dictionary with no frontend feature currently depending on it. Dropped in favour of Gemini's locality NER until a concrete product need arises.

**7. No broker/spam classifier**
NoBroker and Housing.com are owner-only platforms by design. Reddit and Telegram posts are community-driven and already low-broker in practice. A logistic regression classifier would need labelled training data and ongoing retraining as patterns evolve — complexity that solves a problem the data sources mostly already solve.

**8. Regex pre-filter before Gemini for Reddit/Telegram listing detection**
Posts with "looking for", "seeking flatmate", "need a room" in the title are obvious non-listings that can be caught with a keyword match before spending an API call. This meaningfully reduces batch size on high-activity days. Ambiguous cases — posts that pass the regex but are still non-listings — are caught by the `is_listing` field in the Gemini extraction response.

**9. Conservative deduplication (all 5 criteria must match)**
The asymmetry of errors favours precision: a missed duplicate means a user sees the same flat twice (minor annoyance). A false-positive duplicate suppresses a genuinely unique listing from search (user misses a real option). Five matching criteria — locality, BHK, rent within 5%, area within 30 sqft, address token overlap — are deliberately strict to avoid the worse outcome.

**10. Per-room listings flagged, not dropped**
Per-room rent in a shared flat is a real, searchable offering — dropping it silently loses valid signal. The problem is comparability: a ₹8,000/room listing in a 3BHK looks like a suspiciously cheap 3BHK. Solution: detect it, flag `is_per_room = true`, exclude from locality median calculations (to protect `locality_stats_cache`), and display it as a separate card type in the UI.

**11. Stale marking moved to the Transform Layer**
Originally embedded in each ingestion script, stale marking had a subtle bug: if a scraper had a partial run (fetched 40% of the source before timing out), it would prematurely increment `consecutive_misses` on listings it simply hadn't reached yet. Moving stale marking to the Transform Layer, using `ingestion_runs.started_at` as the cycle boundary and only running after a confirmed complete run, eliminates this class of false-stale errors.

**12. Curated tables are always fully re-derivable from raw**
No transform job ever deletes from or mutates the raw `listings` or `locality_feed` tables. All writes to curated tables are upserts. This means any curated table corruption — from a transform bug, a bad Gemini batch, or a botched migration — can be fully recovered by re-running all transform flows against the unchanged raw data. The raw layer is the source of truth; the curated layer is a derived view that happens to be materialised for query performance.

---

## 6. Observability

### Two Layers

**Layer 1 — Pipeline: `ingestion_runs` + `transform_runs` tables**
The primary observability layer. Your own Postgres audit log with no retention limits. Every ingestion and transform job writes a row at start and updates it on completion/failure.

`ingestion_runs` (existing) — one row per ingest cycle per source:

| Column | Description |
|---|---|
| `source` | `nobroker / housing / reddit / telegram / reddit_discussions / news` |
| `started_at` | When the run began (used as the stale-marking boundary) |
| `finished_at` | When the run finished |
| `status` | `success / partial / failed` |
| `duration_ms` | Runtime in milliseconds |
| `total_fetched` | Raw count from the source |
| `total_new` / `total_updated` | Count of new vs updated records |
| `total_errors` | Count of per-record errors |
| `locality_counts` | JSONB breakdown per locality |
| `error_message` | Top-level error if the job failed |

`transform_runs` (new) — one row per transform job per cycle:

| Column | Description |
|---|---|
| `job_name` | e.g. `stale_marking`, `fuzzy_locality`, `listing_extraction`, `quality_rescoring`, `editor_agent`, `health_check` |
| `source` | Source the job ran for (NULL for cross-source jobs like dedup) |
| `started_at` / `finished_at` | Job timing |
| `status` | `success / partial / failed / warning` |
| `duration_ms` | Runtime in milliseconds |
| `records_processed` / `records_failed` / `records_skipped` | Counts |
| `gemini_calls` / `gemini_fallback_count` | Gemini API usage and fallback tracking |
| `error_message` | Top-level error if the job failed |
| `metadata` | JSONB — flexible bag for job-specific stats (e.g. `{"duplicates_found": 12}`, `{"avg_score": 67.3}`) |

**Layer 2 — Record-Level: `gemini_tagged` / `gemini_fallback` flags**
Stamped on every row in `listings_curated` and `feed_curated`. Answers: *which specific records right now are missing quality scores or sentiment tags because Gemini was unavailable?* These rows are re-processed by a nightly job once the API is healthy.

---

### Health Checks

A standalone health check script (`transforms/check_health.py`) runs hourly via Railway Cron and detects:

| Condition | Detection Logic | Logged As |
|---|---|---|
| Ingestion source goes silent | `ingestion_runs.finished_at` for a source is > 2× its expected cron interval | `transform_runs` row with `job_name = 'health_check'`, `status = 'warning'` |
| Gemini fallback rate elevated | `gemini_fallback_count / gemini_calls > 10%` in any `transform_runs` row from the last 24h | Same health check row, details in `metadata` JSONB |
| Locality sentiment crashes | (Phase 2) 24h avg `sentiment_score` drops > 0.3 vs 7-day rolling avg for any locality | Surfaced in internal dashboard |

---

### Custom Internal Dashboard

A lightweight internal React page (or Retool board) querying your own Postgres. Shows:
- **Per-job status grid** — last 7 days of `ingestion_runs` and `transform_runs` rows as a colour-coded grid (green / yellow / red per job per day)
- **Gemini health panel** — `gemini_fallback_count / gemini_calls` per job over time; highlights any job where the fallback rate has been elevated for more than one cycle
- **Pending re-processing count** — `SELECT COUNT(*) FROM listings_curated WHERE gemini_fallback = true` and same for `feed_curated`; shows how many records are currently on defaults
- **Active listing health** — count of `active / stale / expired` listings per source, trending over time

The dashboard reads directly from Supabase via the existing REST API — no additional backend work required beyond the `transform_runs` table being populated by the transform jobs.

---

## 7. API Layer

The Flask backend (`app.py`) acts as the data access layer between the frontend and the Supabase database. All user-facing data should go through the backend API — not direct Supabase JS client calls from the frontend — so that query logic, filtering, and auth are centralised.

**Current state:** The Pulse page and Locality Guide page query Supabase directly from the frontend JS client, doing all aggregation in JavaScript. This will be migrated to backend API endpoints once the curated tables are in place.

---

### Listings APIs

| Endpoint | Method | Description |
|---|---|---|
| `/api/search` | GET | Main listings search. Filters: `area`, `bhk`, `budget`, `min_budget`, `sources`, `sort`, `min_score`, `limit`. Returns ranked results from `listings_curated`. |
| `/api/search/new` | GET | Polls for listings newer than a `since` ISO8601 timestamp, matching saved-search params. Used by the My Hub alert badge. |
| `/api/listing/<id>` | GET | Single listing detail by composite ID (`source_sourceid`). |

---

### Pulse / Feed APIs

These endpoints do not yet exist. Currently the Pulse frontend page makes 4 direct Supabase queries and aggregates everything in JavaScript.

| Endpoint | Method | Description |
|---|---|---|
| `/api/pulse/feed` | GET | Main curated feed from `feed_curated`. Optional filters: `locality`, `topic`, `category`. Returns `featured` (editor-ranked) posts first, then remaining posts ordered by `relevance_score DESC`. |
| `/api/pulse/topics` | GET | List of all active `canonical_topic` slugs with post count and avg sentiment for the last 30 days. Used for topic filter chips in the UI. |
| `/api/pulse/trending` | GET | Currently trending topics (`is_trending = true` in `feed_curated`) ordered by `trending_score DESC`. |
| `/api/pulse/locality/<locality>` | GET | Locality-specific sentiment summary: rolling 7-day avg sentiment, top topics, recent high-relevance posts for that locality. Used by the Locality Guide detail page. |

---

### Locality & Stats APIs

| Endpoint | Method | Description |
|---|---|---|
| `/api/localities` | GET | All locality reference data (coordinates, radius, aliases). Optional `area` param returns expanded locality group and canonical name. Already exists. |
| `/api/locality-stats/<locality>` | GET | Rent stats for a locality from `locality_stats_cache`: median rent, P25/P75, deposit stats, `median_price_per_sqft` per BHK. Currently the frontend reads `locality_stats_cache` directly via the Supabase JS client — this endpoint centralises that. |

---

### User Data APIs

User data (saved listings, saved searches, search logs) is currently handled entirely by direct Supabase JS client calls from the frontend, using Supabase Row Level Security for auth. This is acceptable for now — no Flask backend involvement needed for user data unless auth or business logic needs to be centralised in the future.

| Frontend Operation | Current Mechanism | Notes |
|---|---|---|
| Save / unsave a listing | Direct Supabase insert/delete on `saved_listings` | RLS ensures users only see their own rows |
| Load My Hub saved leads | Direct Supabase query on `saved_listings` | Stale badge requires a join or secondary query against `listings_curated.status` |
| Saved searches | Direct Supabase read/write on `saved_searches` | |
| Search logs | Direct Supabase insert on `search_logs` | |

---

### Alerts APIs (Email Notifications)

| Endpoint | Method | Description |
|---|---|---|
| `POST /api/alerts` | POST | Create a saved search alert (email, area, bhk, budget, keywords). |
| `DELETE /api/alerts/<id>` | DELETE | Remove an alert. |
| `GET /api/alerts/check` | GET | Internal: poll all alerts, check for new matching listings, send email notifications. Called by a Railway Cron job, not the frontend. |

---

### Ops / Internal APIs

| Endpoint | Method | Description |
|---|---|---|
| `/api/pipeline-status` | GET | Ingestion + transform pipeline health. Queries `ingestion_runs`, `transform_runs`, and curated table `gemini_fallback` counts. |
| `/api/ingestion/status` | GET | Listing counts by source and locality. |
| `/api/locality-feed/status` | GET | Pulse feed stats: total posts, last 24h, untagged count per source. |
| `/api/stats` | GET | PostHog analytics (unique visitors, page views). Token-protected, internal only. |
| `/api/health` | GET | Service liveness check. |
