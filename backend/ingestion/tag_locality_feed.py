#!/usr/bin/env python3
"""
Gemini tagger for the NestIQ locality feed.

Reads all untagged rows from locality_feed (topic IS NULL or sentiment IS NULL),
sends them in a SINGLE batch Gemini call, and writes topic + sentiment back.
This uses ~1-2 Gemini API calls per day regardless of post volume.

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

GEMINI_BASE  = "https://generativelanguage.googleapis.com"
BATCH_LIMIT  = 200   # max rows per run (fits easily in Gemini's 1M token window)

# Tried in order — first one that responds 200 wins
CANDIDATE_MODELS = [
    ("v1beta", "gemini-2.0-flash-lite"),
    ("v1beta", "gemini-flash-lite-latest"),
    ("v1beta", "gemini-2.0-flash"),
    ("v1beta", "gemini-flash-latest"),
    ("v1beta", "gemini-2.5-flash"),
]

VALID_TOPICS     = {"water", "infra", "rent", "commute", "safety", "vibe", "other"}
VALID_SENTIMENTS = {"positive", "neutral", "negative"}
FALLBACK_TOPIC     = "other"
FALLBACK_SENTIMENT = "neutral"

BATCH_PROMPT_HEADER = """\
You are tagging social media posts and news articles about neighbourhoods in Bengaluru, India.

For each numbered post below, return a JSON array where each element has:
- "id": the post number (integer)
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

Return ONLY the JSON array. No explanation, no markdown, no extra text.

Posts:
"""


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GEMINI_API_KEY environment variable is not set")
    return key


def _strip_fences(raw: str) -> str:
    """Remove markdown code fences Gemini sometimes adds despite instructions."""
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        # Drop first line (```json or ```) and last line (```)
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return text.strip()


def _validate_tag(topic: str, sentiment: str) -> tuple[str, str]:
    t = str(topic).strip().lower()
    s = str(sentiment).strip().lower()
    return (
        t if t in VALID_TOPICS     else FALLBACK_TOPIC,
        s if s in VALID_SENTIMENTS else FALLBACK_SENTIMENT,
    )


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
    return [{"id": r[0], "title": r[1] or "", "body": r[2] or ""} for r in cur.fetchall()]


def bulk_update(conn, results: list[dict]) -> tuple[int, int]:
    """Write topic + sentiment for all tagged rows. Returns (succeeded, failed)."""
    cur = conn.cursor()
    succeeded = 0
    failed    = 0
    for r in results:
        try:
            cur.execute(
                "UPDATE locality_feed SET topic = %s, sentiment = %s WHERE id = %s",
                (r["topic"], r["sentiment"], r["db_id"]),
            )
            succeeded += 1
        except Exception as e:
            logger.error("DB update failed for id=%s: %s", r["db_id"], e)
            failed += 1
    conn.commit()
    return succeeded, failed


# ── Gemini raw HTTP ───────────────────────────────────────────────────────────

def _probe_model(api_key: str) -> tuple[str, str] | None:
    """Find the first working (api_version, model) pair for this API key."""
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


def call_gemini_batch(
    api_key: str, api_version: str, model: str, rows: list[dict]
) -> list[dict]:
    """
    Send all rows in a single Gemini call.
    Returns list of {db_id, topic, sentiment} — falls back gracefully per item.
    """
    # Build numbered post list (use 1-based index as the "id" in the prompt)
    post_lines = []
    for i, row in enumerate(rows, start=1):
        title = row["title"][:200]
        body  = (row["body"] or "")[:400]
        post_lines.append(f"[{i}] Title: {title}\nBody: {body}")

    prompt = BATCH_PROMPT_HEADER + "\n\n".join(post_lines)

    url = f"{GEMINI_BASE}/{api_version}/models/{model}:generateContent"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 2048},
    }

    try:
        resp = requests.post(url, params={"key": api_key}, json=payload, timeout=60)
        if resp.status_code != 200:
            logger.error("Gemini batch call failed HTTP %d: %s", resp.status_code, resp.text[:300])
            return _all_fallbacks(rows)

        raw_text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        logger.debug("Gemini raw response: %.500s", raw_text)
        return _parse_batch_response(raw_text, rows)

    except Exception as e:
        logger.error("Gemini batch call exception: %s", e)
        return _all_fallbacks(rows)


def _parse_batch_response(raw: str, rows: list[dict]) -> list[dict]:
    """Parse Gemini's batch JSON array response into tagged results."""
    text = _strip_fences(raw)

    try:
        items = json.loads(text)
        if not isinstance(items, list):
            raise ValueError("Expected a JSON array")
    except Exception as e:
        logger.warning("Could not parse Gemini batch response (%s) — falling back all: %.200s", e, raw)
        return _all_fallbacks(rows)

    # Build a lookup by the prompt index (1-based)
    index_map = {i + 1: row for i, row in enumerate(rows)}
    results   = []
    seen      = set()

    for item in items:
        try:
            idx   = int(item["id"])
            row   = index_map.get(idx)
            if row is None or idx in seen:
                continue
            seen.add(idx)
            topic, sentiment = _validate_tag(item.get("topic", ""), item.get("sentiment", ""))
            results.append({"db_id": row["id"], "topic": topic, "sentiment": sentiment})
            logger.info("  [%s] topic=%-8s sentiment=%s  %.60s", row["id"], topic, sentiment, row["title"])
        except Exception as e:
            logger.warning("Could not parse item %s: %s", item, e)

    # Any rows Gemini missed → fallback
    for i, row in enumerate(rows, start=1):
        if i not in seen:
            logger.warning("  [%s] missing from Gemini response — using fallback", row["id"])
            results.append({"db_id": row["id"], "topic": FALLBACK_TOPIC, "sentiment": FALLBACK_SENTIMENT})

    return results


def _all_fallbacks(rows: list[dict]) -> list[dict]:
    return [{"db_id": r["id"], "topic": FALLBACK_TOPIC, "sentiment": FALLBACK_SENTIMENT} for r in rows]


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    api_key = _get_api_key()

    model_info = _probe_model(api_key)
    if model_info is None:
        logger.error(
            "No working Gemini model found. Check that the Generative Language API is "
            "enabled at https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com"
        )
        sys.exit(1)
    api_version, model = model_info

    conn = get_connection()
    rows = fetch_untagged(conn)
    total = len(rows)

    if total == 0:
        logger.info("No untagged posts — nothing to do")
        conn.close()
        print("\nTagging complete.\nPosts processed:    0\nSuccessfully tagged: 0\nFallbacks used:     0")
        return

    logger.info("Fetched %d untagged posts — sending as single batch to Gemini", total)

    results   = call_gemini_batch(api_key, api_version, model, rows)
    succeeded, failed = bulk_update(conn, results)

    fallbacks = sum(
        1 for r in results
        if r["topic"] == FALLBACK_TOPIC and r["sentiment"] == FALLBACK_SENTIMENT
    )

    conn.close()

    print(
        f"\nTagging complete.\n"
        f"Posts processed:     {total}\n"
        f"Successfully tagged: {succeeded - fallbacks}\n"
        f"Fallbacks used:      {fallbacks}\n"
        f"DB update failures:  {failed}"
    )


if __name__ == "__main__":
    main()
