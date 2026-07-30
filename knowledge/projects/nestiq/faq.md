---
id: nestiq
name: NestIQ
slug: nestiq
file: faq
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
  - data-model.md
  - media.md
updated_at: 2026-06-19
---

# NestIQ — FAQ

### What is NestIQ?

NestIQ is a live web platform at [nestiq.homes](https://nestiq.homes) that aggregates Bangalore rental listings from Reddit, Telegram, NoBroker, Housing.com, PG platforms, and more into one searchable feed. It scores and ranks every listing and adds neighbourhood sentiment through a feature called Pulse.

### Who built NestIQ?

NestIQ was built solo end-to-end — frontend, backend, data pipelines, and AI enrichment — by Nikhil Bansal as a portfolio product. There is no separate team or employer behind it.

### What cities does NestIQ cover?

NestIQ currently covers **Bangalore only**, tracking roughly **49 localities** with centroids, aliases, and zone classifications (North, South, East, West, Central). Expansion to other cities would require new locality reference data and source configuration.

### What listing sources does NestIQ aggregate?

Listings come from NoBroker, Housing.com, Telegram groups, Reddit housing subreddits, 99acres, and PG/coliving operators (Zolo, Colive, Stanza). Each source has a dedicated ingestion script on its own cron schedule. Not every source may have equal inventory volume at any given time.

### What is Pulse?

Pulse is NestIQ's neighbourhood intelligence feature. It aggregates local news and Reddit community discussions, tags them by topic (water, infra, rent, commute, safety, vibe), scores sentiment and relevance, detects trending topics, and uses a daily Gemini Flash editor agent to feature the most insightful posts with short editorial notes.

### What is My Hub?

My Hub is the authenticated workspace where users save listings, track lead status (interested → contacted → visited → rejected), and receive email alerts when new listings match saved searches. Saved listings keep a snapshot even if the original listing goes stale on the source platform.

### How does NestIQ score listings?

Each listing gets a composite quality score from four weighted dimensions: price competitiveness vs locality median, locality sentiment from Pulse feed, listing detail completeness, and freshness (exponential decay by age). Weights differ by source — freshness matters more for Reddit/Telegram than for NoBroker/Housing.com.

### What tech stack does NestIQ use?

Frontend: React, Vite, React Router, Supabase JS, PostHog, deployed on Vercel. Backend: Flask, Python, Gunicorn on Railway. Database: Supabase Postgres with raw, curated, and user tables. AI: Gemini Flash Lite and Flash for NLP, rapidfuzz for locality matching, Claude Haiku as rare API fallback. Email via Resend.

### How does the data pipeline work?

External sources are scraped on cron schedules into a Raw Layer in Postgres. A Transform Layer enriches data (Gemini extraction, quality scoring, deduplication, stale marking) and writes to Curated tables (`listings_curated`, `feed_curated`). The Flask API and React frontend read only from curated tables for listings and Pulse — never directly from raw ingest tables.

### Why does Reddit scraping run locally instead of on Railway?

Reddit blocks requests from cloud provider IP ranges (AWS/GCP), which Railway uses. Reddit ingestion and Pulse Reddit scraping run from a local machine via macOS crontab on a residential IP. All other sources run on Railway Cron or GitHub Actions.

### How does NestIQ handle duplicate listings across platforms?

A nightly cross-source deduplication job matches listings when locality, BHK, rent (within 5%), area (within 30 sqft), and address tokens all align. The highest quality-score listing becomes canonical; duplicates are hidden from search but retained in the database.

### How can I try NestIQ?

Visit [https://nestiq.homes](https://nestiq.homes). Search by locality from the landing page or `/app`. Explore neighbourhood sentiment at `/locality-guide`. Sign in to save listings and set up email alerts in My Hub (`/new`).

### How is NestIQ different from NoBroker or Housing.com?

NestIQ is an aggregator, not a broker platform. It pulls from multiple channels including informal sources (Reddit, Telegram) that traditional portals do not cover, deduplicates cross-platform listings, tracks freshness with a stale/expired lifecycle, and combines search with neighbourhood Pulse sentiment. It does not facilitate transactions or charge brokerage.

### Does NestIQ use AI?

Yes. Gemini Flash Lite classifies Reddit/Telegram posts as real listings and extracts structured fields (BHK, rent, deposit, rent type). It also tags Pulse posts for category, topic, sentiment, locality, and relevance in a single batch call. A daily Gemini Flash editor agent curates featured neighbourhood stories. Total Gemini cost is roughly $3–4/year at current scale.

### Is NestIQ open source?

Yes. The NestIQ source code is publicly available on GitHub. The repository includes the React frontend, Flask backend, ingestion scripts, transform pipeline, and database migrations.

### How many users does NestIQ have?

As of June 2026: **1.3k unique visitors** (all time), **29 registered accounts**, and **9 PWA installs** (tracked from May 2026). Product analytics also show **1.4k searches** and **2.0k listing detail opens** all time.

### How many listings does NestIQ track?

**2,437 active listings** across 8 sources, with **21,079 total** records including stale and expired history. 99acres is the largest source by volume (8,273 total, 608 active). Stanza contributes 86 active PG listings.

### What is Reva?

**[Reva](../reva/index.md)** is NestIQ's AI Twitter persona at [@reva_nestiq](https://x.com/reva_nestiq). It posts twice-daily neighbourhood rental intel sourced from the Pulse curated feed. It is a separate portfolio project card but shares the NestIQ database and codebase.
