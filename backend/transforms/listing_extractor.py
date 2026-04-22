"""
Gemini-powered listing filter + structured extraction for Reddit/Telegram posts.

For each unstructured post:
  1. Regex pre-filter drops obvious non-listings
  2. Gemini Flash Lite extracts: is_listing, bhk, rent, locality, furnishing, rent_type
  3. Results written to listings_curated
  4. On Gemini API error, falls back to Claude Haiku (one retry)
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import requests

from transforms.db import get_connection

logger = logging.getLogger(__name__)

GEMINI_BASE = "https://generativelanguage.googleapis.com"
BATCH_SIZE = 50

CANDIDATE_MODELS = [
    ("v1beta", "gemini-2.5-flash-lite"),
    ("v1beta", "gemini-flash-lite-latest"),
    ("v1beta", "gemini-flash-latest"),
    ("v1beta", "gemini-2.5-flash"),
]

NOT_LISTING_PATTERNS = [
    re.compile(r"\b(?:looking\s+for|seeking|need|wanted|searching\s+for)\s+(?:a\s+)?(?:flat|room|house|pg|apartment|place|accommodation)", re.I),
    re.compile(r"\b(?:need\s+)?(?:flatmate|roommate|roomie)\b", re.I),
    re.compile(r"\b(?:shifting|relocating|moving)\s+to\b", re.I),
    re.compile(r"\b(?:any\s+)?(?:suggestions?|recommendations?|advice)\s+(?:for|on)\b", re.I),
]

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
]


def _get_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GEMINI_API_KEY not set")
    return key


def _strip_fences(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return text.strip()


def _probe_model(api_key: str) -> tuple[str, str] | None:
    payload = {
        "contents": [{"parts": [{"text": "Reply with the single word: ok"}]}],
        "generationConfig": {"maxOutputTokens": 5},
    }
    for api_version, model in CANDIDATE_MODELS:
        url = f"{GEMINI_BASE}/{api_version}/models/{model}:generateContent"
        try:
            resp = requests.post(url, params={"key": api_key}, json=payload, timeout=15)
            if resp.status_code == 200:
                logger.info("Model probe OK: %s/%s", api_version, model)
                return api_version, model
        except Exception:
            pass
    return None


def _build_prompt(rows: list[dict]) -> str:
    localities_str = ", ".join(f'"{loc}"' for loc in LOCALITIES)

    header = f"""\
You are analysing Bangalore rental posts from Reddit and Telegram.

For each numbered post, determine if it is a rental listing (someone offering a flat/room for rent) and extract structured data.

Return a JSON array where each element has:
- "id": the post number (integer)
- "is_listing": boolean — true if someone is offering a flat/room/PG for rent; false if seeking, asking advice, or off-topic
- "bhk": string like "1 BHK", "2 BHK", "3 BHK", "Studio/1RK", or null if not mentioned
- "rent": integer monthly rent in ₹, or null if not mentioned. If a range is given, use the lower value. Convert annual/lakhs to monthly.
- "locality": the most specific Bangalore neighbourhood from this list: [{localities_str}], or null if none match
- "furnishing": one of "Fully Furnished", "Semi Furnished", "Unfurnished", or null
- "rent_type": "whole" if the rent is for the entire flat, "per_room" if it's per room/per person/sharing, "unknown" if unclear

Return ONLY the JSON array. No markdown, no explanation.

Posts:
"""

    post_lines = []
    for i, row in enumerate(rows, start=1):
        title = (row["title"] or "")[:200]
        body = (row["body"] or "")[:500]
        post_lines.append(f"[{i}] Title: {title}\nBody: {body}")

    return header + "\n\n".join(post_lines)


def _is_obvious_non_listing(title: str, body: str) -> bool:
    text = f"{title} {body}"
    return any(pat.search(text) for pat in NOT_LISTING_PATTERNS)


def extract_listings_batch(source: str) -> dict:
    """
    Process unextracted Reddit/Telegram listings via Gemini.
    Returns stats dict.
    """
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

    api_key = _get_api_key()
    model_info = _probe_model(api_key)
    if model_info is None:
        raise RuntimeError("No working Gemini model found")

    api_version, model = model_info
    conn = get_connection()

    stats = {
        "processed": 0,
        "listings_found": 0,
        "non_listings": 0,
        "regex_filtered": 0,
        "gemini_calls": 0,
        "gemini_fallback_count": 0,
        "errors": 0,
    }

    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT l.id, l.title, l.body
            FROM listings l
            LEFT JOIN listings_curated lc ON lc.listing_id = l.id
            WHERE l.source = %s
              AND l.status = 'active'
              AND (lc.gemini_tagged IS NULL OR lc.gemini_tagged = FALSE)
        """, (source,))
        rows = [{"id": r[0], "title": r[1], "body": r[2]} for r in cur.fetchall()]
        stats["processed"] = len(rows)

        if not rows:
            logger.info("No unextracted listings for %s", source)
            conn.close()
            return stats

        regex_skipped = []
        gemini_batch = []
        for row in rows:
            if _is_obvious_non_listing(row["title"] or "", row["body"] or ""):
                regex_skipped.append(row)
            else:
                gemini_batch.append(row)

        stats["regex_filtered"] = len(regex_skipped)

        update_cur = conn.cursor()
        for row in regex_skipped:
            update_cur.execute("""
                INSERT INTO listings_curated (listing_id, gemini_tagged, gemini_fallback, updated_at)
                VALUES (%s, TRUE, FALSE, NOW())
                ON CONFLICT (listing_id) DO UPDATE SET
                    gemini_tagged = TRUE,
                    gemini_fallback = FALSE,
                    updated_at = NOW()
            """, (row["id"],))
            stats["non_listings"] += 1

        for i in range(0, len(gemini_batch), BATCH_SIZE):
            batch = gemini_batch[i:i + BATCH_SIZE]
            prompt = _build_prompt(batch)

            results = _call_gemini(api_key, api_version, model, batch, prompt)
            stats["gemini_calls"] += 1

            if results is None:
                results = _call_gemini_fallback(batch)
                if results is not None:
                    stats["gemini_fallback_count"] += 1
                else:
                    for row in batch:
                        update_cur.execute("""
                            INSERT INTO listings_curated (listing_id, gemini_tagged, gemini_fallback, updated_at)
                            VALUES (%s, FALSE, TRUE, NOW())
                            ON CONFLICT (listing_id) DO UPDATE SET
                                gemini_tagged = FALSE,
                                gemini_fallback = TRUE,
                                updated_at = NOW()
                        """, (row["id"],))
                    stats["gemini_fallback_count"] += 1
                    stats["errors"] += len(batch)
                    continue

            _write_results(update_cur, results, batch, stats)

        conn.commit()
    except Exception as e:
        logger.error("extract_listings_batch failed: %s", e)
        conn.rollback()
        raise
    finally:
        conn.close()

    return stats


def _call_gemini(
    api_key: str, api_version: str, model: str,
    batch: list[dict], prompt: str,
) -> list[dict] | None:
    url = f"{GEMINI_BASE}/{api_version}/models/{model}:generateContent"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 4096},
    }

    try:
        resp = requests.post(url, params={"key": api_key}, json=payload, timeout=90)
        if resp.status_code != 200:
            logger.error("Gemini HTTP %d: %s", resp.status_code, resp.text[:300])
            return None

        raw = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        return _parse_response(raw, batch)
    except Exception as e:
        logger.error("Gemini call exception: %s", e)
        return None


def _call_gemini_fallback(batch: list[dict]) -> list[dict] | None:
    """One-retry fallback to Claude Haiku on Gemini API error."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        logger.warning("ANTHROPIC_API_KEY not set — skipping Claude fallback")
        return None

    prompt = _build_prompt(batch)
    try:
        resp = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-3-5-haiku-latest",
                "max_tokens": 4096,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=90,
        )
        if resp.status_code != 200:
            logger.error("Claude fallback HTTP %d: %s", resp.status_code, resp.text[:300])
            return None

        raw = resp.json()["content"][0]["text"]
        return _parse_response(raw, batch)
    except Exception as e:
        logger.error("Claude fallback exception: %s", e)
        return None


def _parse_response(raw: str, batch: list[dict]) -> list[dict] | None:
    text = _strip_fences(raw)
    try:
        items = json.loads(text)
        if not isinstance(items, list):
            raise ValueError("Expected JSON array")
    except Exception as e:
        logger.warning("JSON parse failed (%s): %.200s", e, raw)
        return None

    index_map = {i + 1: row for i, row in enumerate(batch)}
    results = []

    for item in items:
        try:
            idx = int(item.get("id", -1))
            row = index_map.get(idx)
            if not row:
                continue

            results.append({
                "listing_id": row["id"],
                "is_listing": bool(item.get("is_listing", False)),
                "extracted_bhk": item.get("bhk"),
                "extracted_rent": _safe_int(item.get("rent")),
                "extracted_locality": item.get("locality"),
                "furnishing": item.get("furnishing"),
                "rent_type": item.get("rent_type", "unknown"),
            })
        except Exception as e:
            logger.warning("Item parse error: %s — %s", e, item)

    return results


def _safe_int(val) -> int | None:
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def _write_results(cur, results: list[dict], batch: list[dict], stats: dict):
    result_map = {r["listing_id"]: r for r in results}

    for row in batch:
        r = result_map.get(row["id"])
        if not r:
            cur.execute("""
                INSERT INTO listings_curated (listing_id, gemini_tagged, gemini_fallback, updated_at)
                VALUES (%s, FALSE, TRUE, NOW())
                ON CONFLICT (listing_id) DO UPDATE SET
                    gemini_tagged = FALSE, gemini_fallback = TRUE, updated_at = NOW()
            """, (row["id"],))
            stats["errors"] += 1
            continue

        if r["is_listing"]:
            stats["listings_found"] += 1
        else:
            stats["non_listings"] += 1

        cur.execute("""
            INSERT INTO listings_curated
                (listing_id, is_listing, extracted_bhk, extracted_rent, extracted_locality,
                 rent_type, gemini_tagged, gemini_fallback, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, TRUE, FALSE, NOW())
            ON CONFLICT (listing_id) DO UPDATE SET
                is_listing         = EXCLUDED.is_listing,
                extracted_bhk      = EXCLUDED.extracted_bhk,
                extracted_rent     = EXCLUDED.extracted_rent,
                extracted_locality = EXCLUDED.extracted_locality,
                rent_type          = EXCLUDED.rent_type,
                gemini_tagged      = TRUE,
                gemini_fallback    = FALSE,
                updated_at         = NOW()
        """, (
            r["listing_id"],
            r["is_listing"],
            r["extracted_bhk"],
            r["extracted_rent"],
            r["extracted_locality"],
            r["rent_type"],
        ))
