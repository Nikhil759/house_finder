---
id: nestiq
name: NestIQ
slug: nestiq
file: technical-decisions
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
  - data-model.md
  - media.md
  - faq.md
updated_at: 2026-06-19
---

# NestIQ — Technical Decisions

## Orchestration — Cron over Prefect or Airflow

NestIQ uses cron scheduling (Railway Cron, GitHub Actions, local crontab, Supabase pg_cron) instead of Prefect or Airflow. At current scale — roughly eight ingestion scripts and a handful of transform jobs — an orchestration platform adds always-on processes, metadata databases, and operational overhead without proportional benefit.

Scheduling visibility comes from `ingestion_runs` and `transform_runs` Postgres audit tables. Dependency chaining is a direct function call: each ingestion script invokes `run_post_ingest_transforms()` or `run_post_pulse_transforms()` at the end of `main()`, guaranteeing transforms run immediately after a successful ingest without DAG signalling.

## Reddit Runs Locally, Not on Railway

Reddit blocks requests from known cloud provider IP ranges (AWS/GCP), which Railway uses. All three Reddit fallback tiers (OAuth API → public `.json` → PullPush) still originate from the same datacenter IP when run on Railway.

Reddit scrapers (`ingest_reddit.py`, `scrape_reddit_discussions.py`) run from a residential IP via local macOS crontab. Both Railway and local runs write to the same `ingestion_runs` and `transform_runs` tables, so observability is unified.

## Storage — Supabase plus Railway

**Supabase** hosts Postgres and bundles Auth, Row Level Security, and a JavaScript client. The frontend reads and writes user data (saved listings, searches, preferences) directly via Supabase JS with RLS enforcing per-user isolation — no separate auth service or user-data API layer.

Supabase Cron runs the nightly `refresh_locality_stats()` job, keeping Postgres maintenance on the same platform as the database.

**Railway** hosts Flask and Python ingestion/transform scripts with environment variable management and git-based deploys. It is not used for Reddit scrapers due to IP blocking.

## No External Cache Layer

Redis was evaluated and rejected. Listing search hits Postgres with a partial index on `status = 'active'` covering ~1,500 active rows out of ~4,600 total — query execution is milliseconds; the bottleneck is network round-trip to Supabase, not query time.

Locality stats are pre-computed nightly into `locality_stats_cache` and `deposit_stats_cache`; the frontend reads them with a simple `SELECT`. A Redis layer would add cache invalidation complexity (listings change status every 3–6 hours) without meaningful gain at this scale.

Scaling path if read pressure grows: Supabase read replica (Pro plan) routes frontend reads to a separate Postgres server without application-level invalidation logic.

## Hybrid Transform Scheduling

Transform jobs split into fast path (per-ingest) and slow path (nightly) based on time sensitivity.

Fast path runs immediately after ingestion because stale marking depends on the specific run's `started_at` timestamp, and Reddit/Telegram listing extraction affects search correctness right away.

Slow path (quality rescoring, deduplication, rent anomaly flagging, editor agent) depends on `locality_stats_cache` (refreshed at 2 AM) and benefits from seeing all four listing sources complete. Running these per-cycle would produce inconsistent mid-day scores.

## Gemini Flash Lite as Primary NLP Model

RoBERTa is deterministic and free but requires model hosting, does not generalise to extraction tasks, and handles Indian English poorly out of the box. spaCy PhraseMatcher is fast but needs a manually maintained Bangalore entity dictionary.

Gemini Flash Lite handles listing classification, structured field extraction, Pulse tagging (category, topic, sentiment, locality NER, relevance) in a single batch API call at roughly $3–4/year at current scale. The cost-to-complexity ratio strongly favours Gemini; RoBERTa remains a considered fallback if API instability becomes recurring.

## Gemini Flash for the Editor Agent

Flash Lite produces mechanically repetitive Pulse shortlists — it tends to pick highest-upvote posts regardless of narrative value. The editor agent's purpose is contextual editorial judgment: distinguishing an insightful community post from a routine complaint. That requires Gemini Flash. The editor runs once daily on a small batch, not per-cycle on thousands of records.

## Ranking over Scoring for the Editor

LLMs produce more stable relative judgments ("A is better than B") than stable absolute scores ("A = 0.87"). Ranking forces explicit tradeoffs within a batch and avoids score inflation. A rank shift between runs is expected; a score shift of ±0.2 with identical input is misleading.

## Claude Haiku as API-Error Fallback Only

Malformed JSON from Gemini is handled within the transform job: the record gets `gemini_fallback = true` and neutral defaults, then re-processes nightly. Claude Haiku is invoked only when Gemini's API returns an error response (rate limit, outage) — not for JSON parsing failures. This keeps vendor dependency rare and cost near-zero.

## No spaCy for Entity Extraction

Gemini already extracts locality names as part of the Pulse tagging batch call. A spaCy PhraseMatcher for Bangalore-specific entities (metro stations, roads, BBMP/BWSSB) would require maintaining a custom entity dictionary with no frontend feature currently depending on it. Dropped until a concrete product need arises.

## No Broker or Spam Classifier

NoBroker and Housing.com are owner-only platforms by design. Reddit and Telegram posts are community-driven and already low-broker in practice. A logistic regression classifier would need labelled training data and ongoing retraining — complexity that solves a problem the data sources mostly already solve.

## Regex Pre-Filter before Gemini for Listings

Posts with "looking for", "seeking flatmate", or "need a room" in the title are obvious non-listings caught by keyword match before spending an API call. Ambiguous cases pass through to Gemini's `is_listing` field in the extraction response.

## Conservative Cross-Source Deduplication

Error asymmetry favours precision: a missed duplicate means a user sees the same flat twice (minor annoyance). A false-positive duplicate suppresses a genuinely unique listing (user misses a real option).

Five matching criteria must all hold: locality, BHK, rent within 5%, area within 30 sqft, address token overlap. Deliberately strict to avoid the worse outcome.

## Per-Room Listings Flagged, Not Dropped

Per-room rent in a shared flat is a real offering. The problem is comparability: ₹8,000/room in a 3BHK looks like a suspiciously cheap 3BHK. Solution: detect via regex ("per head", "per person", "sharing basis") or Gemini `rent_type` extraction, set `is_per_room = true`, exclude from locality median calculations, and display as a separate card type in the UI.

## Stale Marking Moved to Transform Layer

Originally embedded in ingestion scripts, stale marking had a bug: a partial scrape (40% of localities before timeout) would increment `consecutive_misses` on listings the scraper simply had not reached yet.

Moving stale marking to the Transform Layer, using `ingestion_runs.started_at` as the cycle boundary and running only after a confirmed complete run, eliminates false-stale errors.

## Curated Tables Fully Re-Derivable from Raw

No transform job deletes from or mutates raw `listings` or `locality_feed` tables. All curated writes are upserts. Any curated table corruption — from a transform bug, bad Gemini batch, or botched migration — can be recovered by re-running all transform flows against unchanged raw data. Raw is source of truth; curated is a materialised view for query performance.

## Dual-Write Raw plus Normalised Columns

Storing both normalised columns and `raw_payload` JSONB on the same row means the raw layer supports reprocessing while normalised columns serve immediate query needs. The Transform Layer reads normalised columns for routine operations, not JSONB parsing.

## Frontend User Data via Supabase RLS

Saved listings, searches, preferences, and search logs use direct Supabase JS client calls with RLS — not Flask endpoints. This is acceptable because RLS enforces per-user isolation and there is no complex server-side business logic on user data today. Flask centralises listings, Pulse, and stats queries where filtering and joins are non-trivial.

## API Centralisation for Pulse and Stats

Pulse and Locality Guide pages previously queried Supabase directly and aggregated in JavaScript. These were migrated to Flask API endpoints reading from `feed_curated` and `locality_stats_cache`, centralising query logic and enabling future auth or rate limiting without frontend changes.

## Two Misses before Stale, Not One

A single missed cycle can mean a transient rate limit or API timeout — not that the listing is gone. Two consecutive misses require absence across two independent runs, making false stale-marking extremely unlikely.
