---
id: reva
name: Reva
slug: reva
file: technical-decisions
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
  - media.md
  - faq.md
updated_at: 2026-06-19
---

# Reva — Technical Decisions

## Persona over Brand Account

Reva's system prompt explicitly states: "You are not a brand account." The voice is a sharp Bangalorean friend, not a startup marketing channel. Hard rules ban corporate phrases, hashtags, hype words ("amazing", "incredible"), and explaining the joke. This keeps tweets shareable and distinct from property-portal social media.

## Literary Voice — Worldview, Not Parody

Style modifiers reference great authors (Dostoevsky, Orwell, R.K. Narayan, Ray, Bond, Kafka, Chekhov, Manto, Murakami, Vonnegut) but the prompt forbids parody, archaic English, abstract philosophy, and naming the author in the tweet. The goal is rhythm and worldview accessible to someone scrolling Twitter who has never read the author.

Positive-sentiment signals use a separate warmer modifier pool (Narayan, Ray, Bond, Chekhov, Vonnegut) to avoid applying melancholy literary voices to good news.

## Gemini 2.5 Flash over Flash Lite

NestIQ's Pulse tagging uses Gemini Flash Lite for high-volume batch classification. Reva uses **Gemini 2.5 Flash** because tweet writing requires editorial judgment — tone, irony, compression, and locality-specific wit in under 215 characters. One tweet per run, twice daily — cost is negligible relative to quality.

## Data-Grounded, Never Invented

Every tweet starts from a real `feed_curated` post with locality, topic, sentiment score, title, body excerpt, and optional editor note. The model is instructed to stay specific to that signal. If Pulse has no curated posts, Reva does not post — no fallback to generic rental advice.

## 215-Character Body Limit

Tweet body is capped at 215 characters before link append. This leaves room for a newline + t.co URL (counted as 23 chars) within Twitter's 280-character limit. Bodies over 215 still post if within 280 weighted length, but trigger a warning — the target keeps tweets punchy.

## One Idea Per Tweet

The system prompt enforces: "One idea per tweet. Never two." Combined with "Never start with 'I'" and "No em dashes", this produces the short declarative style visible in high-performing tweets (e.g. the Bellandur commute tweet).

## Anti-Repetition — Three Layers

**Layer 1 — Coverage dedup (7 days):** `reva_log` tracks `feed_id` and `(locality, canonical_topic)`. The same story or same neighbourhood+topic combo is not re-used within a week.

**Layer 2 — Recent tweet memory (12 tweets):** Full tweet text fed into the prompt as banned patterns and opening words.

**Layer 3 — Post-generation similarity check:** Jaccard overlap > 0.55 or matching 4-word opener vs recent tweets triggers retry (up to 3 attempts).

This stack prevents Reva from sounding repetitive even when Bangalore rental news clusters around the same topics.

## 50/50 Link Strategy

Roughly half of tweets link to the **original source** (news article or Reddit thread) for credibility; half link to the **NestIQ locality Pulse page** to drive product discovery. If the last two tweets used the same link type, the next tweet alternates. Source links require a non-empty `url` on the Pulse post.

## Trending and Editor Signals First

Post selection prioritises `is_trending` and low `editor_rank` (editor-featured stories) before raw relevance score. This aligns Reva's social output with what NestIQ's own Pulse editor agent already judged worth featuring — human editorial judgment upstream, literary compression downstream.

## Logging Before Trusting Memory

Every posted tweet is written to `reva_log` immediately after a successful Twitter API response. Coverage dedup and anti-repetition depend on this table — if logging fails, the tweet still goes out but dedup may drift until the next successful log.

## Separate Project, Shared Database

Reva runs in the NestIQ repo and reads the same Supabase Postgres instance. No separate database or API layer — intentional simplicity. Reva is a portfolio project card because the product surface (AI persona, voice design, social automation) is distinct from the NestIQ web platform, even though the code ships together.

## Dry-Run Before Production

`reva_tweet_test.py` picks 10 diverse posts (`pick_diverse_posts` — max one per locality and topic) and generates tweets without posting. Used to validate prompt changes, style modifiers, and length constraints before deploying to the live @reva_nestiq account.

## Extensible Mode System

`MODE = "literary"` and `MODE_LABELS` map to log mode names (`pulse_drop_literary`, `pulse_drop_literary_positive`). The architecture supports additional tweet types (e.g. listing highlights, weekly roundup) by adding modes without restructuring the pipeline.
