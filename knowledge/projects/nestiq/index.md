---
id: nestiq
name: NestIQ
slug: nestiq
file: index
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
  - architecture.md
  - technical-decisions.md
  - data-model.md
  - media.md
  - faq.md
updated_at: 2026-06-19
---

# NestIQ

## Overview

NestIQ is a live web platform at [nestiq.homes](https://nestiq.homes) for finding rental homes in Bangalore. It aggregates listings from multiple sources — Reddit, Telegram, NoBroker, Housing.com, 99acres, and PG operators (Zolo, Colive, Stanza) — into a single searchable feed. Each listing receives a composite quality score so renters can compare options across platforms without checking each site manually.

A second product surface, **Pulse**, surfaces neighbourhood sentiment: local news, Reddit discussions, topic tags (water, commute, safety, vibe), and an AI-curated featured feed. **My Hub** lets signed-in users save listings, track lead status, and receive email alerts for new matches.

The product is built solo end-to-end: React frontend on Vercel, Flask API and data pipelines on Railway, Postgres on Supabase, and scheduled ingestion via Railway Cron, GitHub Actions, and local crontab for Reddit jobs.

## Problem

Bangalore renters hunt across fragmented channels — broker platforms, Reddit threads, Telegram groups, and PG sites — with no unified view. Listings duplicate across sources, go stale without notice, and neighbourhood context (water cuts, safety, commute) lives in scattered discussions rather than beside the listings themselves.

Generic property portals optimise for inventory volume, not signal. Reddit and Telegram posts are unstructured free text. There is no cross-source deduplication, freshness tracking, or scoring that accounts for price competitiveness and locality sentiment together.

## Solution

NestIQ runs a multi-source data pipeline that ingests listings and neighbourhood content on cron schedules, normalises them into Postgres, enriches them through a Transform Layer (rule-based jobs plus Gemini NLP), and serves curated results through a Flask API to a React PWA.

Listings flow through a **Raw → Transform → Curated** architecture. Search reads from `listings_curated` with quality scores, deduplication, and stale filtering. Pulse reads from `feed_curated` with sentiment, topics, trending detection, and a daily editor agent that picks featured neighbourhood stories.

User data (saved listings, saved searches, preferences, alerts) is stored in Supabase with Row Level Security; the frontend writes directly via the Supabase JS client.

## Key Features

### Search

Unified rental search across ingested sources. Filters include locality, BHK, budget range, source, minimum quality score, and sort order. Results are ranked by composite quality score. Only `active` listings appear in search; stale and expired listings are retained for analytics and saved-listing snapshots.

### Pulse (Locality Guide)

City-wide and per-locality feeds of neighbourhood news and community discussions. Posts are tagged by topic (water, infra, rent, commute, safety, vibe), scored for sentiment and relevance, and surfaced with trending topic detection. A daily Gemini Flash editor agent ranks the best posts and writes short editorial notes for featured items.

### My Hub

Authenticated workspace for saved listings with a status workflow: interested → contacted → visited → rejected. Saved listings store a JSON snapshot at save time so they remain visible even after the source listing goes stale. Email alerts notify users when new listings match saved search criteria.

### Locality Guide & Locality Detail

Rent statistics per locality and BHK from nightly-computed cache tables: median rent, P25/P75, deposit benchmarks, and price-per-sqft where available. Locality detail pages combine rent stats with Pulse sentiment for that neighbourhood.

### Listing Detail

Full listing view with source link, quality score breakdown, flag/report flow for community moderation, and view tracking.

### Email Alerts

Saved-search alerts sent via Resend (`alerts@nestiq.homes`). Users can manage frequency and unsubscribe via signed email action tokens.

### Reva (Twitter / X)

**[Reva](../reva/index.md)** is NestIQ's AI Twitter persona ([@reva_nestiq](https://x.com/reva_nestiq)). It posts twice-daily rental intel from Pulse curated data in a literary voice. Built on the same Postgres pipeline; separate portfolio project card.

### PWA

Installable progressive web app with service worker registration for mobile home-screen install.

## Outcomes & Metrics

### Usage (all time, PostHog)

- **1.3k unique visitors**, **8.8k total page views**, **1.4k searches**, **2.0k listing detail opens**
- **7m 24s** average session duration
- Top sections: Listing Detail (2.1k views), Locality Guide (361), Neighbourhood Guide (207)
- **29 registered accounts**, **9 PWA installs** (tracked from May 2026)

### Data inventory (June 2026)

- **2,437 active listings** across **8 sources** (99acres, Housing, NoBroker, Reddit, Telegram, Zolo, Colive, Stanza)
- **21,079 total listings** including stale and expired history
- **99acres** is the largest source by total volume (8,273 records, 608 active)
- **~49 Bangalore localities** in the reference `localities` table
- SQLite read replica: 43,027 rows, 96.5 MB, ~40 syncs per 24 hours

### Pipeline health

- Gemini API (`gemini-flash-lite-latest`) available; **zero records** in fallback re-processing queue
- Full data-pipeline migration (ingestion, transforms, curated tables, API centralisation, `/health` observability dashboard) is complete

See [media.md](./media.md) for dashboard screenshots.

Gemini NLP costs for listing extraction and Pulse tagging are estimated at roughly **$3–4/year** at current volume.

## Stack

### Frontend

React 18, Vite, React Router, Framer Motion, Supabase JS (auth and user data), PostHog (analytics), Vercel Analytics. Deployed on **Vercel**. DM Sans + DM Mono typography with amber accent (`#E8A020`).

### Backend

Flask 3, Gunicorn, Python 3. Structured JSON logging with request IDs. Deployed on **Railway**.

### Data

Supabase Postgres (raw layer, curated layer, user tables, stats cache). Optional SQLite read replica for faster API reads. Migrations in `backend/migrations/`.

### AI / ML

Google Gemini Flash Lite (listing extraction, Pulse tagging), Gemini Flash (daily editor/curator agent), Claude Haiku (API-error fallback for Gemini outages), rapidfuzz (Bangalore locality fuzzy matching).

### Infra & Orchestration

Railway Cron (non-Reddit ingestion, slow-path transforms, health checks), GitHub Actions (ingestion workflows for several sources), local macOS crontab (Reddit scrapers — cloud IPs are blocked), Supabase Cron (nightly `refresh_locality_stats()`).

### Integrations

Reddit OAuth API (with public JSON and PullPush fallbacks), Telegram MTProto (Telethon), NoBroker, Housing.com, Google News / NewsAPI, Resend (email), PostHog (server + client).

## Links & Demos

- **Live site:** [https://nestiq.homes](https://nestiq.homes)
- **Email:** hello@nestiq.homes (reply-to for alerts)

## Documentation Map

Companion files in this folder:

| File | Contents |
|------|----------|
| [architecture.md](./architecture.md) | Ingestion, storage, transform pipeline, API layer, observability |
| [data-model.md](./data-model.md) | Tables, entities, relationships, and current volumes |
| [technical-decisions.md](./technical-decisions.md) | Orchestration, caching, model selection, dedup philosophy, and other tradeoffs |
| [media.md](./media.md) | Screenshots and architecture diagrams with captions |
| [faq.md](./faq.md) | Common visitor and recruiter questions |

## Related Projects

**[Reva](../reva/index.md)** — AI Twitter persona ([@reva_nestiq](https://x.com/reva_nestiq)) that consumes Pulse curated feed data and posts twice-daily Bangalore rental intel. Separate portfolio project; code lives in this repo under `backend/reva_*.py`.

## Limitations & Future Work

- Coverage is **Bangalore-only** (~49 tracked localities).
- Reddit ingestion must run from a residential IP, not Railway — operational constraint, not a product limitation.
- Some architecture-doc deferred items remain: Gemini fallback rate webhook alerting, SQL-based sentiment anomaly detection, retiring legacy dev wrapper scripts.
- Public stats and user-growth metrics are documented in [media.md](./media.md) and [index.md](./index.md#outcomes--metrics).
