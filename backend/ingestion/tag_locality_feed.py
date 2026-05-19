#!/usr/bin/env python3
"""
Gemini tagger for the NestIQ locality feed.

Reads untagged rows from locality_feed (category IS NULL), sends them in
a single batch Gemini call, and writes back:
  - category           (discussion / news / listing / flatmate_search / spam)
  - canonical_topic    (from feed_topics or a new auto-created tag)
  - sentiment_score    (-1.0 … 1.0)
  - relevance_score    (0.0 … 1.0)
  - detected_localities (array of neighbourhood names)
  - topic / sentiment  (derived for backward compat)

The canonical topic list is loaded from the feed_topics table at runtime,
so new topics propagate automatically.

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
BATCH_LIMIT  = 200

CANDIDATE_MODELS = [
    ("v1beta", "gemini-2.5-flash-lite"),
    ("v1beta", "gemini-flash-lite-latest"),
    ("v1beta", "gemini-2.5-flash"),
    ("v1beta", "gemini-flash-latest"),
    ("v1beta", "gemini-2.0-flash"),
]

VALID_CATEGORIES = {"discussion", "news", "listing", "flatmate_search", "spam"}
FALLBACK_CATEGORY = "discussion"

LOCALITIES = [
    "Whitefield", "HSR Layout", "Koramangala", "Indiranagar",
    "Marathahalli", "Bellandur", "BTM Layout", "Hebbal",
    "Yelahanka", "Electronic City", "Sarjapur Road", "Hoodi",
    "Jayanagar", "Bannerghatta", "Banaswadi", "KR Puram",
    "JP Nagar", "Banashankari", "Rajajinagar", "Malleshwaram",
    "Yeshwanthpur", "HBR Layout", "Bommanahalli",
    "Hennur", "Thanisandra", "Kalyan Nagar", "RT Nagar",
    "Domlur", "Frazer Town", "MG Road", "Cunningham Road",
    "Ulsoor", "Basavanagudi", "Sadashivanagar", "Vijayanagar",
    "Kengeri", "Nagawara", "Old Airport Road",
    "Brookefield", "Varthur", "Panathur", "Manyata",
    "Bengaluru General",
]


def _build_prompt_header(canonical_topics: list[str]) -> str:
    topics_str = ", ".join(f'"{t}"' for t in canonical_topics)
    localities_str = ", ".join(f'"{loc}"' for loc in LOCALITIES)

    return f"""\
You are classifying social media posts and news articles about neighbourhoods in Bengaluru, India.

For each numbered post below, return a JSON array where each element has:
- "id": the post number (integer)
- "category": one of ["discussion", "news", "listing", "flatmate_search", "spam"]
- "canonical_topic": choose from this list: [{topics_str}]. \
If the post clearly fits one of these, use it. \
If NOT, return a single lowercase word that best captures the topic \
(e.g. "pets", "parking", "pollution", "festivals"). \
Do NOT force-fit into an existing topic — a specific new word is better.
- "sentiment_score": float from -1.0 to 1.0 in 0.1 increments (e.g. -0.7, -0.3, 0.2, 0.6). \
Use the full range, not just -1/-0.5/0/0.5/1. Guidelines: \
-1.0 = extreme outrage/danger, -0.7 = strong frustration, -0.4 = mild complaint, \
-0.1 = slightly negative, 0.0 = purely neutral/factual, 0.1 = slightly positive, \
0.4 = mild appreciation, 0.7 = strong praise, 1.0 = enthusiastic celebration.
- "relevance_score": float from 0.0 to 1.0. How relevant is this post to \
understanding neighbourhood sentiment in Bengaluru? \
1.0 = highly relevant discussion or news. 0.0 = spam or completely off-topic.
- "localities": array of neighbourhood names from this list: [{localities_str}]. \
Pick ALL neighbourhoods mentioned in or clearly relevant to the post. \
If the post is about the city in general, return ["Bengaluru General"]. \
A post can be relevant to multiple localities.

Category guide:
- "discussion": community conversations about living in the area, opinions, experiences
- "news": news articles about the neighbourhood or city
- "listing": rental property advertisements (flat for rent, PG available, etc.)
- "flatmate_search": posts seeking or offering flatmates/roommates
- "spam": promotional content, irrelevant posts, ads

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
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return text.strip()


def _clamp(value, lo, hi):
    try:
        v = float(value)
        return max(lo, min(hi, v))
    except (TypeError, ValueError):
        return None


def _score_to_label(score: float | None) -> str:
    if score is None:
        return "neutral"
    if score <= -0.3:
        return "negative"
    if score >= 0.3:
        return "positive"
    return "neutral"


# ── DB operations ─────────────────────────────────────────────────────────────

def fetch_canonical_topics(conn) -> list[str]:
    """Load the current canonical topic slugs from feed_topics."""
    cur = conn.cursor()
    cur.execute("SELECT slug FROM feed_topics ORDER BY slug")
    return [r[0] for r in cur.fetchall()]


def ensure_topic_exists(conn, slug: str, known: set[str]) -> None:
    """Auto-insert a new topic into feed_topics if it doesn't exist."""
    if slug in known:
        return
    cur = conn.cursor()
    label = slug.replace("_", " ").title()
    try:
        cur.execute(
            """
            INSERT INTO feed_topics (slug, label)
            VALUES (%s, %s)
            ON CONFLICT (slug) DO NOTHING
            """,
            (slug, label),
        )
        conn.commit()
        known.add(slug)
        logger.info("  Auto-created new topic: %s", slug)
    except Exception as e:
        logger.error("  Failed to create topic %s: %s", slug, e)
        conn.rollback()


def fetch_untagged(conn) -> list[dict]:
    """Fetch up to BATCH_LIMIT untagged rows from locality_feed."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, title, body, locality
        FROM locality_feed
        WHERE category IS NULL
        ORDER BY scraped_at DESC
        LIMIT %s
        """,
        (BATCH_LIMIT,),
    )
    return [
        {"id": r[0], "title": r[1] or "", "body": r[2] or "", "locality": r[3] or ""}
        for r in cur.fetchall()
    ]


def bulk_update(conn, results: list[dict]) -> tuple[int, int]:
    """Write all tagged fields for each row. Returns (succeeded, failed)."""
    cur = conn.cursor()
    succeeded = 0
    failed = 0
    for r in results:
        try:
            sentiment_label = _score_to_label(r.get("sentiment_score"))
            cur.execute(
                """
                UPDATE locality_feed
                SET category            = %s,
                    canonical_topic     = %s,
                    sentiment_score     = %s,
                    relevance_score     = %s,
                    detected_localities = %s,
                    topic               = %s,
                    sentiment           = %s
                WHERE id = %s
                """,
                (
                    r["category"],
                    r["canonical_topic"],
                    r.get("sentiment_score"),
                    r.get("relevance_score"),
                    r.get("detected_localities", []),
                    r["canonical_topic"],
                    sentiment_label,
                    r["db_id"],
                ),
            )
            succeeded += 1
        except Exception as e:
            logger.error("DB update failed for id=%s: %s", r["db_id"], e)
            failed += 1
    conn.commit()
    return succeeded, failed


# ── Gemini raw HTTP ───────────────────────────────────────────────────────────

def _probe_model(api_key: str) -> tuple[str, str] | None:
    """Find the first working (api_version, model) pair."""
    payload = {
        "contents": [{"parts": [{"text": "Reply with the single word: ok"}]}],
        "generationConfig": {"maxOutputTokens": 5},
    }
    for api_version, model in CANDIDATE_MODELS:
        url = f"{GEMINI_BASE}/{api_version}/models/{model}:generateContent"
        try:
            resp = requests.post(url, params={"key": api_key}, json=payload, timeout=15)
            if resp.status_code == 200:
                logger.info("Model probe succeeded: %s / %s", api_version, model)
                return api_version, model
            logger.debug("Probe %s/%s → HTTP %d", api_version, model, resp.status_code)
        except Exception as e:
            logger.debug("Probe %s/%s failed: %s", api_version, model, e)
    return None


def call_gemini_batch(
    api_key: str, api_version: str, model: str,
    rows: list[dict], prompt_header: str,
) -> list[dict]:
    """Send all rows in a single Gemini call."""
    post_lines = []
    for i, row in enumerate(rows, start=1):
        title = row["title"][:200]
        body = (row["body"] or "")[:400]
        post_lines.append(f"[{i}] Title: {title}\nBody: {body}")

    prompt = prompt_header + "\n\n".join(post_lines)

    url = f"{GEMINI_BASE}/{api_version}/models/{model}:generateContent"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 8192},
    }

    try:
        resp = requests.post(url, params={"key": api_key}, json=payload, timeout=120)
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
    """Parse Gemini's batch JSON array into tagged results."""
    text = _strip_fences(raw)

    try:
        items = json.loads(text)
        if not isinstance(items, list):
            raise ValueError("Expected a JSON array")
    except Exception as e:
        logger.warning("Could not parse Gemini response (%s) — falling back: %.200s", e, raw)
        return _all_fallbacks(rows)

    index_map = {i + 1: row for i, row in enumerate(rows)}
    results = []
    seen = set()

    for item in items:
        try:
            idx = int(item["id"])
            row = index_map.get(idx)
            if row is None or idx in seen:
                continue
            seen.add(idx)

            category = str(item.get("category", "")).strip().lower()
            if category not in VALID_CATEGORIES:
                category = FALLBACK_CATEGORY

            canonical_topic = str(item.get("canonical_topic", "other")).strip().lower()
            canonical_topic = canonical_topic.replace(" ", "_")[:30]

            sentiment_score = _clamp(item.get("sentiment_score"), -1.0, 1.0)
            relevance_score = _clamp(item.get("relevance_score"), 0.0, 1.0)

            localities = item.get("localities", [])
            if not isinstance(localities, list):
                localities = []
            detected = [str(loc).strip() for loc in localities if str(loc).strip()]

            results.append({
                "db_id": row["id"],
                "category": category,
                "canonical_topic": canonical_topic,
                "sentiment_score": sentiment_score if sentiment_score is not None else 0.0,
                "relevance_score": relevance_score if relevance_score is not None else 0.5,
                "detected_localities": detected,
            })
            logger.info(
                "  [%s] cat=%-16s topic=%-12s sent=%+.2f rel=%.2f locs=%s  %.50s",
                row["id"], category, canonical_topic,
                sentiment_score or 0.0, relevance_score or 0.5,
                ",".join(detected[:3]) or "-",
                row["title"],
            )
        except Exception as e:
            logger.warning("Could not parse item %s: %s", item, e)

    for i, row in enumerate(rows, start=1):
        if i not in seen:
            logger.warning("  [%s] missing from Gemini response — using fallback", row["id"])
            results.append(_single_fallback(row))

    return results


def _single_fallback(row: dict) -> dict:
    return {
        "db_id": row["id"],
        "category": FALLBACK_CATEGORY,
        "canonical_topic": "other",
        "sentiment_score": 0.0,
        "relevance_score": 0.5,
        "detected_localities": [row["locality"]] if row.get("locality") else ["Bengaluru General"],
    }


def _all_fallbacks(rows: list[dict]) -> list[dict]:
    return [_single_fallback(r) for r in rows]


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

    canonical_topics = fetch_canonical_topics(conn)
    logger.info("Loaded %d canonical topics: %s", len(canonical_topics), canonical_topics)

    prompt_header = _build_prompt_header(canonical_topics)

    rows = fetch_untagged(conn)
    total = len(rows)

    if total == 0:
        logger.info("No untagged posts — nothing to do")
        conn.close()
        print(
            "\nTagging complete.\n"
            "Posts processed:     0\n"
            "Successfully tagged: 0\n"
            "Rejected:            0\n"
            "New topics created:  0"
        )
        return

    logger.info("Fetched %d untagged posts — sending as single batch to Gemini", total)

    results = call_gemini_batch(api_key, api_version, model, rows, prompt_header)

    known_topics = set(canonical_topics)
    new_topics = 0
    for r in results:
        if r["canonical_topic"] not in known_topics:
            ensure_topic_exists(conn, r["canonical_topic"], known_topics)
            new_topics += 1

    succeeded, failed = bulk_update(conn, results)

    rejected = sum(1 for r in results if r["category"] in ("listing", "flatmate_search", "spam"))
    discussions = sum(1 for r in results if r["category"] in ("discussion", "news"))

    conn.close()

    print(
        f"\nTagging complete.\n"
        f"Posts processed:     {total}\n"
        f"Successfully tagged: {succeeded}\n"
        f"  Discussions/news:  {discussions}\n"
        f"  Rejected:          {rejected}\n"
        f"New topics created:  {new_topics}\n"
        f"DB update failures:  {failed}"
    )

    from sync.trigger import trigger_sync_after_completion
    trigger_sync_after_completion(reason="tag_locality_feed")


if __name__ == "__main__":
    main()
