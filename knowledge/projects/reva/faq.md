---
id: reva
name: Reva
slug: reva
file: faq
category: enterprise-ai
tags: [ai-agent, social-automation, gemini, twitter, proptech, bangalore, nestiq]
employer: null
role: solo-builder
status: live
one_liner: AI Twitter persona for NestIQ that posts twice-daily Bangalore rental intel grounded in Pulse neighbourhood data, written in a literary voice.
stack: [Python, Gemini, Tweepy, PostgreSQL, Supabase, Railway]
links:
  - label: Twitter / X
    url: https://x.com/reva_nestiq
  - label: NestIQ
    url: https://nestiq.homes
doc_type: project
visibility: public
related_files:
  - index.md
  - architecture.md
  - technical-decisions.md
  - media.md
updated_at: 2026-06-19
---

# Reva — FAQ

### What is Reva?

Reva is an AI-powered Twitter/X persona ([@reva_nestiq](https://x.com/reva_nestiq)) that posts Bangalore rental and neighbourhood intel for [NestIQ](https://nestiq.homes). It turns real Pulse feed data — news, Reddit discussions, sentiment, trending topics — into short literary tweets twice a day.

### Is Reva the same as NestIQ?

No. NestIQ is the web platform (search, Pulse, My Hub). Reva is NestIQ's social media voice — a separate product built on top of NestIQ's Pulse data pipeline. They share a database but serve different audiences: renters browsing the web vs people scrolling Twitter.

### Who built Reva?

Reva was built solo as part of the NestIQ ecosystem — same author, same codebase (`backend/reva_*.py`), but positioned as its own portfolio project for the AI agent and voice-design work.

### How often does Reva post?

Twice daily: **9:00 AM IST** and **9:00 PM IST**, via Railway Cron running `reva_pulse_tweet.py`.

### What data does Reva tweet about?

Reva selects from NestIQ's `feed_curated` Pulse posts — neighbourhood news and community discussions tagged by locality (e.g. Bellandur, Koramangala) and topic (water, commute, rent, safety, vibe). Trending and editor-featured stories are prioritised.

### What AI model does Reva use?

**Gemini 2.5 Flash** with a custom system prompt defining voice, tone, and constraints. This is separate from NestIQ's Gemini Flash Lite batch tagging — Reva needs editorial compression, not classification.

### What is Reva's tone?

Sharp, slightly sardonic, always on the renter's side. Literary in rhythm but plain in vocabulary — written for someone scrolling Twitter, not a literature seminar. Dry wit for hard signals; quiet warmth for good news. No hashtags, no corporate speak, never starts with "I".

### How does Reva avoid repeating itself?

Three mechanisms: (1) `reva_log` excludes the same Pulse post or locality+topic combo for 7 days, (2) the last 12 tweets are fed into the prompt as banned patterns, (3) generated text is rejected if too similar by word overlap or opening words. Up to 3 Gemini retries per run.

### What links does Reva include?

Each tweet ends with one link: either the original news/Reddit source (~50%) or the NestIQ locality Pulse page at `nestiq.homes/neighbourhood-pulse/{locality}` (~50%).

### How can I follow Reva?

Follow [@reva_nestiq on X](https://x.com/reva_nestiq).

### Has Reva had viral tweets?

Yes. A May 2026 tweet about Bellandur commute ("paying for proximity to office… stuck five kilometers from it") reached **262.6K views**, **59 likes**, and **15 reposts**. See [media.md](./media.md).

### Is Reva open source?

Yes. Reva's code is in the public NestIQ GitHub repository under `backend/reva_tweet_common.py`, `reva_pulse_tweet.py`, and related scripts.

### Does Reva invent facts?

No. Every tweet is grounded in a real curated Pulse post with locality, topic, sentiment, and content excerpt. If no curated posts exist in the database, Reva skips the run rather than generating generic content.

### Can Reva tweet about listings?

Not currently. The active mode is `pulse_drop_literary` — neighbourhood signals only. Listing highlights could be added as a future mode.
