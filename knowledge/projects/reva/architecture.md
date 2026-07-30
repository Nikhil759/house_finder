---
id: reva
name: Reva
slug: reva
file: architecture
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
  - technical-decisions.md
  - media.md
  - faq.md
updated_at: 2026-06-19
---

# Reva — Architecture

## System Overview

Reva is a scheduled Python job — not a web service. It reads from NestIQ's Postgres database, calls Gemini, posts to Twitter, and logs the result.

```
NestIQ Pulse pipeline
  locality_feed → feed_curated (tagged, ranked, trending)
        ↓
reva_pulse_tweet.py (Railway Cron, 2× daily)
  ├── fetch_recent_coverage() — reva_log 7-day dedup
  ├── fetch_best_post() — select signal from feed_curated
  ├── fetch_last_tweets() — last 12 for anti-repetition
  ├── generate_tweet_with_retry() — Gemini 2.5 Flash
  ├── compose_tweet_with_link() — append source or NestIQ URL
  ├── post_tweet() — Tweepy Twitter API v2
  └── log_tweet() — INSERT into reva_log
        ↓
@reva_nestiq on X
```

There is no frontend, API server, or user auth. The only runtime dependencies are Postgres (read + write), Gemini API, and Twitter API credentials.

## Source Data Selection

Reva reads from the same curated Pulse tables as the NestIQ web app.

### Query logic

`fetch_best_post()` joins `feed_curated` with `locality_feed` and filters:

- Scraped within the last **48 hours** (relaxes to **168 hours** if no match)
- `locality` and `canonical_topic` are not null
- `category IN ('discussion', 'news')` — no raw listings or spam

### Ranking priority

```sql
ORDER BY
  fc.is_trending DESC NULLS LAST,
  fc.editor_rank ASC NULLS LAST,
  lf.relevance_score DESC
LIMIT 1
```

Trending neighbourhood topics win first, then editor-featured posts, then highest relevance.

### Coverage exclusion

`fetch_recent_coverage()` reads `reva_log` for the last **7 days** and builds:

- `exclude_feed_ids` — specific Pulse posts already tweeted
- `exclude_pairs` — `(locality, canonical_topic)` combinations already covered

If no post matches with exclusions, the query relaxes: drops pair exclusion, then feed_id exclusion, then widens the time window, then drops sentiment preference.

## Tweet Generation

### Model

**Gemini 2.5 Flash** via `google.generativeai` with `system_instruction=SYSTEM_PROMPT` (fixed persona and hard rules).

### Prompt structure

Each generation call includes:

- **Data signal:** locality, topic, sentiment score/label, source, trending flag, editor note
- **Content snippet:** title (200 chars) + body excerpt (300 chars) from the Pulse post
- **Literary style modifier:** random author-inspired instruction (see technical-decisions.md)
- **Sentiment guidance:** positive / negative / neutral tone hint
- **Anti-repetition block:** last 12 tweet texts + banned opening patterns

### Retry loop

Up to **3 attempts** (`MAX_GENERATION_ATTEMPTS`):

1. Normal generation
2. Retry with "too similar or too dense" note — different angle and simpler words
3. Retry with maximum simplicity — different style modifier, one short plain sentence

A candidate is accepted when:

- Body length ≤ **215 characters** (link appended separately)
- Not `is_too_similar()` to recent tweets

### Similarity detection

`is_too_similar()` rejects if:

- First 4 words match any recent tweet's opener, or
- Jaccard word overlap > **0.55** (stop words removed)

## Link Composition

After text generation, `compose_tweet_with_link()` appends one URL on a new line:

| Link type | URL | When |
|-----------|-----|------|
| `source` | Original Pulse post URL (news article or Reddit thread) | ~50% of tweets; required if last 2 links were NestIQ |
| `nestiq` | `https://nestiq.homes/neighbourhood-pulse/{locality-slug}` | Default otherwise |

Locality slug: lowercase, spaces → hyphens (e.g. `bellandur`, `hsr-layout`).

### Length accounting

Twitter counts URLs as **23 characters** (t.co). `estimated_tweet_length()` validates the final tweet stays within **280 characters** before posting.

## Posting and Logging

### Twitter API

`tweepy.Client.create_tweet(text=final_text)` using OAuth 1.0a credentials from environment variables.

### reva_log table

Every successful post is logged:

| Column | Description |
|--------|-------------|
| `mode` | e.g. `pulse_drop_literary` or `pulse_drop_literary_positive` |
| `tweet_text` | Full text including appended link |
| `tweet_id` | Twitter post ID |
| `feed_id` | FK to `locality_feed.id` — prevents re-tweeting same story |
| `locality` | Bangalore neighbourhood name |
| `canonical_topic` | Pulse topic slug — prevents same locality+topic within 7 days |
| `posted_at` | Timestamp (implicit/default) |

Indexes: `posted_at DESC`, `feed_id` (partial, where not null). Migration `019_reva_log_coverage.sql` added coverage columns.

### Failure modes

- No curated posts → abort with error (ingestion/tagging must run first)
- Gemini failure → abort, no post
- Tweet > 280 weighted chars → abort, no post
- Twitter API failure → abort; tweet not logged
- Log failure → tweet still posted; warning printed

## Scheduling

Railway Cron runs `reva_pulse_tweet.py`:

| Cron (UTC) | IST | Purpose |
|------------|-----|---------|
| `30 3 * * *` | 9:00 AM | Morning Pulse Drop |
| `30 15 * * *` | 9:00 PM | Evening Pulse Drop |

## Supporting Scripts

| Script | Purpose |
|--------|---------|
| `reva_pulse_tweet.py` | Production cron — generate and post one tweet |
| `reva_tweet_test.py` | Dry-run — generate 10 diverse tweets, no Twitter post |
| `reva_intro_tweet.py` | One-off launch tweet (manual run) |
| `reva_tweet_common.py` | Shared selection, generation, logging, link logic |

## Relationship to NestIQ Pulse

Reva is a **downstream consumer** of NestIQ's Pulse transform pipeline. It does not run ingestion or Gemini tagging itself. If the Pulse pipeline is healthy (see NestIQ `/health` dashboard), Reva has fresh signals. The Pulse editor agent's `editor_note` and `editor_rank` directly influence which stories Reva is likely to pick.
