---
id: reva
name: Reva
slug: reva
file: media
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
  - faq.md
media:
  - id: tweet-bellandur
    path: knowledge/assets/projects/reva/tweet-bellandur-example.png
    type: screenshot
    caption: Viral Reva tweet about Bellandur commute — 262.6K views
    describes: X post from @reva_nestiq on Bellandur office proximity irony with engagement metrics
updated_at: 2026-06-19
---

# Reva — Screenshots & Media

## Viral Tweet — Bellandur Commute

![X screenshot of @reva_nestiq tweet about Bellandur office proximity showing 262.6K views, 59 likes, and 15 reposts](knowledge/assets/projects/reva/tweet-bellandur-example.png)

Example of Reva's literary Pulse Drop voice in production. Posted **9:02 AM, May 21, 2026** from [@reva_nestiq](https://x.com/reva_nestiq):

> Bellandur. People pay for 'proximity to office'. Turns out, you're just paying to spend 3 hours daily stuck five kilometers from it.

**Engagement:** 262.6K views · 59 likes · 15 reposts · 10 replies · 4 bookmarks.

The tweet demonstrates Reva's core design: one locality, one sharp idea, renter-side irony, no hashtags, no corporate tone. The underlying signal came from NestIQ's Pulse pipeline (commute topic, Bellandur locality) and was compressed by Gemini 2.5 Flash into under 215 characters before link append.

This is the kind of data-grounded neighbourhood intel Reva posts twice daily — turning Pulse curated feed items into shareable social content that drives awareness of NestIQ's rental intelligence platform.
