#!/usr/bin/env python3
"""
Gemini tagger for the NestIQ locality feed.

Reads untagged rows from locality_feed (where topic IS NULL or sentiment IS NULL),
calls Gemini 1.5 Flash to classify each post, and writes topic + sentiment back.

Usage:
    python -m ingestion.tag_locality_feed          # from backend/
    python backend/ingestion/tag_locality_feed.py  # from repo root

Required env var:
    GEMINI_API_KEY  — from https://aistudio.google.com/app/apikey
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time

# Allow running from repo root or backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import requests

from ingestion.db import get_connection

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("tag_locality_feed")

# ── Constants ─────────────────────────────────────────────────────────────────

GEMINI_BASE      = "https://generativelanguage.googleapis.com"
BATCH_LIMIT      = 200
RATE_LIMIT_SLEEP = 0.5

# Tried in order — first one that responds 200 wins (v1beta works for all current models)
CANDIDATE_MODELS = [
    ("v1beta", "gemini-2.0-flash-lite"),   # cheapest free-tier
    ("v1beta", "gemini-flash-lite-latest"), # alias
    ("v1beta", "gemini-2.0-flash"),         # standard
    ("v1beta", "gemini-flash-latest"),      # alias
    ("v1beta", "gemini-2.5-flash"),         # newest
]

VALID_TOPICS     = {"water", "infra", "rent", "commute", "safety", "vibe", "other"}
VALID_SENTIMENTS = {"positive", "neutral", "negative"}

FALLBACK_TOPIC     = "other"
FALLBACK_SENTIMENT = "neutral"

PROMPT_TEMPLATE = """\
You are tagging social media posts and news articles about neighbourhoods in Bengaluru, India.

Given a post title and body, return ONLY a JSON object with two fields:
- "topic": one of ["water", "infra", "rent", "commute", "safety", "vibe", "other"]
- "sentiment": one of ["positive", "neutral", "negative"]

Topic guide:
- water: water supply, borewell, Cauvery, tanker, shortage
- infra: metro, roads, BBMP, construction, flyover, power cuts, electricity
- rent: rent prices, deposit, landlord, lease, hike, brokerage
- commute: traffic, Uber, Ola, signal, travel time, congestion
- safety: theft, crime, police, security, harassment
- vibe: restaurants, pubs, parks, walkability, nightlife, community, cleanliness
- other: anything that doesn't fit above

Return ONLY the JSON. No explanation, no markdown, no extra text.

Title: {title}
Body: {body}"""


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GEMINI_API_KEY environment variable is not set")
    return key


def _parse_gemini_response(raw: str) -> tuple[str, str]:
    """
    Parse Gemini's text response into (topic, sentiment).
    Returns fallback values if the JSON is invalid or fields are unexpected.
    """
    # Strip markdown code fences if Gemini adds them despite instructions
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        logger.warning("Could not parse Gemini JSON: %.120s", raw)
        return FALLBACK_TOPIC, FALLBACK_SENTIMENT

    topic     = str(data.get("topic", "")).strip().lower()
    sentiment = str(data.get("sentiment", "")).strip().lower()

    if topic not in VALID_TOPICS:
        logger.warning("Unexpected topic %r — using fallback", topic)
        topic = FALLBACK_TOPIC
    if sentiment not in VALID_SENTIMENTS:
        logger.warning("Unexpected sentiment %r — using fallback", sentiment)
        sentiment = FALLBACK_SENTIMENT

    return topic, sentiment


# ── DB operations ─────────────────────────────────────────────────────────────

def fetch_untagged(conn) -> list[dict]:
    """Fetch up to BATCH_LIMIT untagged rows from locality_feed."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, title, body
        FROM locality_feed
        WHERE topic IS NULL OR sentiment IS NULL
        ORDER BY scraped_at DESC
        LIMIT %s
        """,
        (BATCH_LIMIT,),
    )
    rows = cur.fetchall()
    return [{"id": r[0], "title": r[1] or "", "body": r[2] or ""} for r in rows]


def update_row(conn, row_id: int, topic: str, sentiment: str) -> None:
    """Write topic + sentiment back to a single locality_feed row."""
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE locality_feed
        SET topic = %s, sentiment = %s
        WHERE id = %s
        """,
        (topic, sentiment, row_id),
    )
    conn.commit()


# ── Gemini raw HTTP ───────────────────────────────────────────────────────────

def _probe_model(api_key: str) -> tuple[str, str] | None:
    """
    Try each candidate model with a tiny prompt.
    Returns the first (api_version, model_name) pair that succeeds, or None.
    """
    payload = {
        "contents": [{"parts": [{"text": "Reply with the single word: ok"}]}],
        "generationConfig": {"maxOutputTokens": 5},
    }
    for api_version, model in CANDIDATE_MODELS:
        url = f"{GEMINI_BASE}/{api_version}/models/{model}:generateContent"
        try:
            resp = requests.post(url, params={"key": api_key}, json=payload, timeout=10)
            if resp.status_code == 200:
                logger.info("Model probe succeeded: %s / %s", api_version, model)
                return api_version, model
            logger.debug("Probe %s/%s → HTTP %d", api_version, model, resp.status_code)
        except Exception as e:
            logger.debug("Probe %s/%s failed: %s", api_version, model, e)
    return None


def call_gemini(api_key: str, api_version: str, model: str, title: str, body: str) -> tuple[str, str]:
    """Call the Gemini REST API directly and return (topic, sentiment)."""
    prompt = PROMPT_TEMPLATE.format(title=title[:300], body=body[:600])
    url = f"{GEMINI_BASE}/{api_version}/models/{model}:generateContent"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 50},
    }
    try:
        resp = requests.post(url, params={"key": api_key}, json=payload, timeout=15)
        if resp.status_code != 200:
            logger.error("Gemini API %d: %s", resp.status_code, resp.text[:200])
            return FALLBACK_TOPIC, FALLBACK_SENTIMENT
        data = resp.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return _parse_gemini_response(text)
    except Exception as e:
        logger.error("Gemini call failed: %s", e)
        return FALLBACK_TOPIC, FALLBACK_SENTIMENT


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    api_key = _get_api_key()

    model_info = _probe_model(api_key)
    if model_info is None:
        logger.error(
            "No working Gemini model found for this API key. "
            "Check that the Generative Language API is enabled at "
            "https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com"
        )
        sys.exit(1)
    api_version, model = model_info

    conn = get_connection()
    rows = fetch_untagged(conn)

    total     = len(rows)
    succeeded = 0
    fallbacks = 0

    logger.info("Fetched %d untagged posts to classify", total)

    for row in rows:
        topic, sentiment = call_gemini(api_key, api_version, model, row["title"], row["body"])

        is_fallback = (topic == FALLBACK_TOPIC and sentiment == FALLBACK_SENTIMENT)

        try:
            update_row(conn, row["id"], topic, sentiment)
            if is_fallback:
                fallbacks += 1
            else:
                succeeded += 1
            logger.info(
                "  [%s] topic=%-8s sentiment=%s  %.60s",
                row["id"], topic, sentiment, row["title"],
            )
        except Exception as e:
            logger.error("  DB update failed for id=%s: %s", row["id"], e)
            fallbacks += 1

        time.sleep(RATE_LIMIT_SLEEP)

    conn.close()

    print(
        f"\nTagging complete.\n"
        f"Posts processed:   {total}\n"
        f"Successfully tagged: {succeeded}\n"
        f"Fallbacks used:    {fallbacks}"
    )


if __name__ == "__main__":
    main()
