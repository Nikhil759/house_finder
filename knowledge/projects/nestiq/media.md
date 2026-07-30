---
id: nestiq
name: NestIQ
slug: nestiq
file: media
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
  - faq.md
media:
  - id: analytics-dashboard
    path: knowledge/assets/projects/nestiq/analytics-dashboard-all-time.png
    type: screenshot
    caption: NestIQ analytics dashboard — all-time usage metrics
    describes: Unique visitors, searches, listing opens, and page views by section
  - id: user-growth
    path: knowledge/assets/projects/nestiq/user-growth-metrics.png
    type: screenshot
    caption: PWA installs and registered user accounts
    describes: 9 PWA installs and 29 registered accounts tracked via PostHog
  - id: live-status
    path: knowledge/assets/projects/nestiq/live-status-replica.png
    type: screenshot
    caption: Live system status — Supabase pooler and SQLite read replica
    describes: DB latency, replica sync health, and active listing counts
  - id: pipeline-runs
    path: knowledge/assets/projects/nestiq/pipeline-runs-grid.png
    type: screenshot
    caption: Ingestion pipeline runs grid with per-source status dots
    describes: Last 5 runs per source with success/partial/failed indicators and detail table
  - id: listing-health
    path: knowledge/assets/projects/nestiq/listing-health-by-source.png
    type: screenshot
    caption: Listing health breakdown by source with Gemini API status
    describes: Active, stale, and expired counts per source plus Gemini fallback queue
  - id: architecture-listings
    path: knowledge/assets/projects/nestiq/architecture-listings-pipeline.png
    type: diagram
    caption: Listings data pipeline architecture diagram
    describes: Sources through transformation to Supabase Postgres and SQLite read replica
  - id: architecture-pulse
    path: knowledge/assets/projects/nestiq/architecture-pulse-pipeline.png
    type: diagram
    caption: Pulse neighbourhood feed pipeline diagram
    describes: Reddit and News API ingestion through Gemini transforms to curated feed
updated_at: 2026-06-19
---

# NestIQ — Screenshots & Media

## Product Outcomes — Analytics Dashboard

![NestIQ analytics dashboard showing all-time unique visitors (1.3k), total views (8.8k), searches (1.4k), listing opens (2.0k), and page views by section](knowledge/assets/projects/nestiq/analytics-dashboard-all-time.png)

The admin analytics dashboard (`/analytics`) shows all-time product usage from PostHog. As of the screenshot: **1.3k unique visitors**, **8.8k total page views**, **1.4k searches**, **2.0k listing detail opens**, and **7m 24s average session duration**. Top sections by traffic are Listing Detail (2.1k), Locality Guide (361), and Neighbourhood Guide (207). A monthly visitors chart tracks growth from March to June 2026.

## Product Outcomes — User Growth

![NestIQ user growth panel showing 9 PWA installs and 29 registered accounts identified via PostHog](knowledge/assets/projects/nestiq/user-growth-metrics.png)

User adoption metrics from the stats page. **9 PWA installs** tracked from May 2026 onwards. **29 registered accounts** identified via PostHog sign-in events, with a matching email list of 29 subscribers for product updates.

## Ingestion Metrics — Live System Status

![NestIQ live status panel showing Supabase pooler latency, SQLite read replica with 43k rows, and 2437 active listings across 8 sources](knowledge/assets/projects/nestiq/live-status-replica.png)

The `/health` live status panel monitors production infrastructure. Supabase pooler connects Singapore → Mumbai (port 6543). A SQLite read replica (`nestiq_replica_v2.db`, WAL mode, 10 tables, 43,027 rows, 96.5 MB) syncs from Postgres with ~40 successful syncs per 24 hours. Listing inventory shows **2,437 active** out of **21,079 total** across **8 sources**, with per-source TTL-based expiration.

## Ingestion Metrics — Pipeline Runs

![NestIQ pipeline runs grid showing last 5 ingestion runs per source with colour-coded status dots and a detail table for 99acres, housing, nobroker, and citizen_matters](knowledge/assets/projects/nestiq/pipeline-runs-grid.png)

The pipeline runs section on `/health` tracks every ingestion source. A colour-coded grid shows the last 5 runs per source (green = success, orange = partial, red = failed). Active sources include **99acres**, **stanza**, **nobroker**, **housing**, **telegram**, **zolo**, **colive**, **reddit**, **reddit_discussions**, **news**, **google_news_rss**, and **citizen_matters**. The detail table shows fetched/new/updated/stale counts, errors, duration, and time since last run per execution.

## Ingestion Metrics — Listing Health by Source

![NestIQ listing health table showing active, stale, and expired counts for 99acres, Housing, NoBroker, Reddit, Stanza, Telegram, Zolo, and Colive, plus Gemini API status](knowledge/assets/projects/nestiq/listing-health-by-source.png)

Listing lifecycle breakdown per source. **99acres** leads in total volume (8,273 records, 608 active). **Stanza** has 86 active PG listings with zero stale. **Housing** and **NoBroker** each contribute 600+ active listings. Below the table, Gemini API health shows `gemini-flash-lite-latest` available at 731ms latency with **zero records** in the fallback re-processing queue.

## Architecture — Listings Pipeline

![Hand-drawn architecture diagram of NestIQ listings pipeline from Reddit, Telegram, NoBroker, and Housing.com through data cleaning jobs to Supabase Postgres and a SQLite read replica on Railway, serving a Vercel frontend](knowledge/assets/projects/nestiq/architecture-listings-pipeline.png)

End-to-end listings architecture. Four source APIs (Reddit every 6h, Telegram every 4h, NoBroker and Housing.com every 3h) feed per-source data cleaning jobs on Railway Cron. Cleaned data lands in Supabase Postgres (Mumbai). The NestIQ Flask backend on Railway maintains a SQLite embedded read replica for fast reads. The React frontend on Vercel communicates with the backend across Singapore ↔ Mumbai.

## Architecture — Pulse Pipeline

![Architecture diagram of Pulse showing Reddit and News API ingestion into Supabase raw DB, Gemini-powered transformation to curated DB, Railway backend, and Pulse mobile feed UI](knowledge/assets/projects/nestiq/architecture-pulse-pipeline.png)

Pulse (city-wide news feed and sentiment analysis) pipeline. Reddit scrapes every 3 hours and News API every 12 hours into a Supabase raw database. A Gemini-powered transform step filters, scores, tags, and normalises posts into a curated database. The Railway backend fetches curated data and serves the Pulse page feed with topic tags, sentiment, and relative timestamps.
