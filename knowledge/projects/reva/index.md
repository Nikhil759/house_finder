---
id: reva
name: Reva
slug: reva
file: index
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
  - architecture.md
  - technical-decisions.md
  - media.md
  - faq.md
updated_at: 2026-06-19
---

# Reva

## Overview

Reva is the live Twitter/X persona ([@reva_nestiq](https://x.com/reva_nestiq)) for [NestIQ](https://nestiq.homes). It is an AI agent that turns real Bangalore rental and neighbourhood signals from NestIQ's **Pulse** pipeline into short, opinionated tweets — twice daily, grounded in curated data, not generic social-media copy.

Reva is built as a separate product surface from the NestIQ web app: a Python cron job on Railway reads from `feed_curated`, generates a tweet via **Gemini 2.5 Flash** with a carefully designed literary voice, posts through the **Twitter API** (Tweepy), and logs every post to `reva_log` for anti-repetition and coverage tracking.

Reva is not a brand account. The voice is a sharp, slightly sardonic Bangalorean who knows the rental market and is always on the renter's side.

## Problem

Bangalore renters get their neighbourhood context from scattered Reddit threads, news headlines, and word of mouth. Property portals post inventory, not honest local signal. A typical startup Twitter account would sound corporate and generic — the opposite of what renters actually want to hear.

There was no lightweight, data-backed channel that distilled Pulse neighbourhood intelligence into something shareable and human on social media.

## Solution

Reva automates a daily editorial loop:

1. Select the best recent Pulse post (trending topics and editor-ranked stories prioritised).
2. Generate a tweet in a rotating literary style (inspired by authors like Orwell, R.K. Narayan, Kafka — worldview and rhythm, never parody).
3. Append a link to either the original source article or the NestIQ locality Pulse page.
4. Post to X and log to Postgres so the same locality, topic, or feed item is not repeated within a 7-day window.

The result is rental intel that reads like a friend who lives in Bangalore, backed by NestIQ's ingestion and sentiment pipeline.

## Key Features

### Pulse Drop — Literary mode

The primary tweet mode (`pulse_drop_literary`). Each run picks one curated neighbourhood signal and writes a single-idea tweet (max 215 characters before link) grounded in locality, topic, sentiment, and optional editor notes from the Pulse curator agent.

### Literary style rotation

Ten author-inspired style modifiers rotate randomly (Dostoevsky, Orwell, R.K. Narayan, Satyajit Ray, Ruskin Bond, Kafka, Chekhov, Manto, Murakami, Vonnegut). Positive-sentiment signals use a warmer subset. The tweet never names the author — only captures rhythm and worldview in plain English.

### Sentiment-aware tone

Tone adapts to the underlying Pulse signal: dry wit and weight for hard renter news, quiet warmth and understated hope for genuinely good signals, observational specificity for neutral topics.

### Anti-repetition system

Before generation, the pipeline loads the last 12 tweets and 7-day coverage from `reva_log`. Posts already tweeted (by `feed_id` or `locality + topic` pair) are excluded. Generated text is rejected if too similar to recent tweets (opening-word match or >55% content word overlap). Up to 3 Gemini retries with escalating simplicity prompts.

### Smart link strategy

Each tweet appends one link: ~50% chance of the original news/Reddit source URL, ~50% chance of the NestIQ locality Pulse page (`/neighbourhood-pulse/{locality}`). Alternates automatically if the last two tweets used the same link type.

### Dry-run testing

`reva_tweet_test.py` generates 10 diverse sample tweets without posting — used to validate voice, length, and link composition before production runs.

## Outcomes & Metrics

### Example viral tweet (May 2026)

A Bellandur commute tweet reached **262.6K views**, **59 likes**, **15 reposts**, and **10 replies** on X:

> Bellandur. People pay for 'proximity to office'. Turns out, you're just paying to spend 3 hours daily stuck five kilometers from it.

See [media.md](./media.md) for the screenshot.

### Publishing cadence

- **2 tweets per day** via Railway Cron: 9:00 AM IST and 9:00 PM IST
- Every tweet is grounded in a real Pulse curated post from the last 48 hours (widens to 7 days if needed)

## Stack

### AI

Gemini 2.5 Flash with a fixed system prompt defining Reva's voice, accessibility rules, and hard constraints (no hashtags, no em dashes, never start with "I", one idea per tweet).

### Backend

Python 3, `google-generativeai` SDK, shared logic in `reva_tweet_common.py`, production entry point `reva_pulse_tweet.py`.

### Social

Tweepy (Twitter API v2) for `create_tweet`.

### Data

Reads from NestIQ Supabase Postgres (`feed_curated` JOIN `locality_feed`). Writes to `reva_log` for tweet history and coverage dedup.

### Infra

Railway Cron (`30 3 * * *` and `30 15 * * *` UTC = 9 AM / 9 PM IST).

## Links & Demos

- **Twitter / X:** [https://x.com/reva_nestiq](https://x.com/reva_nestiq)
- **Parent product:** [https://nestiq.homes](https://nestiq.homes)
- **Code:** lives in the NestIQ repo under `backend/reva_*.py`

## Documentation Map

| File | Contents |
|------|----------|
| [architecture.md](./architecture.md) | End-to-end pipeline, post selection, generation, posting, `reva_log` schema |
| [technical-decisions.md](./technical-decisions.md) | Voice design, literary styles, anti-repetition, link strategy, model choice |
| [media.md](./media.md) | Tweet screenshot with engagement metrics |
| [faq.md](./faq.md) | Common visitor and recruiter questions |

## Related Projects

**[NestIQ](../nestiq/index.md)** — the parent rental intelligence platform. Reva consumes Pulse curated feed data from NestIQ's transform pipeline. NestIQ provides search, locality guides, and the web destination linked from Reva tweets.

## Limitations & Future Work

- Currently one tweet mode (`literary` / Pulse Drop); architecture supports additional modes via `MODE` constant.
- Depends on NestIQ Pulse ingestion and tagging — no tweets if `feed_curated` is empty.
- Twitter API credentials required (`TWITTER_CONSUMER_KEY`, `TWITTER_ACCESS_TOKEN`, etc.) — not documented in RAG.
- `reva_log` base table was created outside the numbered migrations; coverage columns added in `019_reva_log_coverage.sql`.
