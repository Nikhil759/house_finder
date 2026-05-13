"""
Gemini-based listing type classifier for Reddit and Telegram listings.

Classifies each listing as one of:
  'full_house', 'pg', 'flatmate', 'not_a_listing'.
Called from Reddit and Telegram ingestion pipelines after text extraction
but before the Supabase upsert.
"""

from __future__ import annotations

import json
import logging
import os

import requests

logger = logging.getLogger(__name__)

GEMINI_BASE = "https://generativelanguage.googleapis.com"
BATCH_SIZE = 40

CANDIDATE_MODELS = [
    ("v1beta", "gemini-2.5-flash-lite"),
    ("v1beta", "gemini-flash-lite-latest"),
    ("v1beta", "gemini-flash-latest"),
    ("v1beta", "gemini-2.5-flash"),
]

VALID_TYPES = frozenset({"full_house", "pg", "flatmate", "not_a_listing"})

CLASSIFICATION_PROMPT = """\
You are classifying Bangalore rental posts into exactly one category.

Categories:

full_house — an entire flat, apartment, or house being rented out as a
single unit. The renter takes the whole place.
  Examples:
    "1BHK available for rent in Indiranagar, owner direct, 25k"
    "Renting out 2BHK in HSR Layout, semi-furnished, family preferred"
    "Studio apartment near Brigade Road, 35k all inclusive"

pg — paying guest accommodation. Bed or room in a managed/serviced
property, usually with meals, often gender-restricted, multiple
unrelated tenants sharing rooms.
  Examples:
    "PG for working women in Marathahalli, AC, food included, 12k"
    "Co-living space in HSR, single occupancy room, all amenities, 18k"
    "Boys PG near Whitefield, 3 sharing, food + wifi, 8k per bed"

flatmate — someone has an existing flat and is looking for a person to
share it with them, OR a room in an already-shared flat. The poster is
NOT renting out the whole place; they want a co-tenant.
  Examples:
    "Looking for a flatmate for my 2BHK in HSR, 18k per person + utilities"
    "Single room available in 3BHK, two existing tenants, working \
professionals only"
    "Need one more roommate for our flat in Koramangala, female only"

not_a_listing — the post is not about renting a place or finding a
flatmate. Includes: civic complaints (potholes, streetlights, traffic),
community news (scams, incidents, accidents), general discussion
(advice questions, opinion threads), property SALE posts (this is a
rental platform, sales count as not_a_listing), pet adoption, lost and
found, events, deals, food posts, anything unrelated to rentals.
  Examples:
    "Blocking road with barricades" → not_a_listing
    "Dangerous Hanging Streetlight & Exposed Wires" → not_a_listing
    "Need advice regarding NIMHANS admission" → not_a_listing
    "For sale: Home at NRI Layout" → not_a_listing (sales not rentals)
    "Caught an alleged petrol pump scam" → not_a_listing
    "2 outgoing 3-month-old male kittens looking for homes" → not_a_listing
    "Moving into a rental house for the first time" → not_a_listing
      (this is a question/discussion, not a listing)

If the post is genuinely a listing but the type is unclear, default to
full_house. If it is unclear whether the post is a listing at all,
default to not_a_listing.

For each numbered post below, return a JSON array where each element has:
- "id": the post number (integer)
- "type": exactly one of "full_house", "pg", "flatmate", "not_a_listing"

Return ONLY the JSON array. No markdown, no explanation.

Posts:
"""


def _get_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GEMINI_API_KEY not set")
    return key


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
                logger.info("Listing type classifier probe OK: %s/%s", api_version, model)
                return api_version, model
        except Exception:
            pass
    return None


def _strip_fences(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return text.strip()


def _build_batch_prompt(listings_data: list[dict]) -> str:
    post_lines = []
    for i, data in enumerate(listings_data, start=1):
        title = (data.get("title") or "")[:200]
        body = (data.get("body") or "")[:500]
        extras = []
        if data.get("rent"):
            extras.append(f"Rent: ₹{data['rent']}")
        if data.get("bhk"):
            extras.append(f"BHK: {data['bhk']}")
        if data.get("locality"):
            extras.append(f"Locality: {data['locality']}")
        extras_str = " | ".join(extras)
        entry = f"[{i}] Title: {title}\nBody: {body}"
        if extras_str:
            entry += f"\n({extras_str})"
        post_lines.append(entry)
    return CLASSIFICATION_PROMPT + "\n\n".join(post_lines)


def _call_gemini(api_key: str, api_version: str, model: str, prompt: str) -> list[dict] | None:
    url = f"{GEMINI_BASE}/{api_version}/models/{model}:generateContent"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.0, "maxOutputTokens": 2048},
    }
    try:
        resp = requests.post(url, params={"key": api_key}, json=payload, timeout=60)
        if resp.status_code != 200:
            logger.error("Gemini classification HTTP %d: %s", resp.status_code, resp.text[:300])
            return None
        raw = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        return _parse_response(raw)
    except Exception as e:
        logger.error("Gemini classification exception: %s", e)
        return None


def _parse_response(raw: str) -> list[dict] | None:
    text = _strip_fences(raw)
    try:
        items = json.loads(text)
        if not isinstance(items, list):
            raise ValueError("Expected JSON array")
    except Exception as e:
        logger.warning("Classification JSON parse failed (%s): %.200s", e, raw)
        return None

    results = []
    for item in items:
        try:
            idx = int(item.get("id", -1))
            ltype = str(item.get("type", "full_house")).strip().lower()
            if ltype not in VALID_TYPES:
                ltype = "full_house"
            results.append({"id": idx, "type": ltype})
        except Exception as e:
            logger.warning("Classification item parse error: %s — %s", e, item)
    return results


def classify_listing_types(listings) -> dict:
    """
    Classify listing_type for a list of StandardListing objects.

    Mutates each listing's listing_type field in place.
    On any failure, falls back to 'full_house'.

    Returns stats dict with classification counts and fallback info.
    """
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

    stats = {
        "total": len(listings),
        "classified": {"full_house": 0, "pg": 0, "flatmate": 0, "not_a_listing": 0},
        "fallback_count": 0,
        "errors": 0,
    }

    if not listings:
        return stats

    try:
        api_key = _get_api_key()
        model_info = _probe_model(api_key)
        if model_info is None:
            logger.error(
                "No working Gemini model for listing type classification "
                "— all %d listings defaulting to full_house", len(listings),
            )
            stats["fallback_count"] = len(listings)
            stats["classified"]["full_house"] = len(listings)
            return stats

        api_version, model = model_info

        for batch_start in range(0, len(listings), BATCH_SIZE):
            batch = listings[batch_start:batch_start + BATCH_SIZE]
            batch_data = [
                {
                    "title": l.title,
                    "body": l.body,
                    "rent": l.rent,
                    "bhk": l.bhk,
                    "locality": l.locality,
                }
                for l in batch
            ]

            prompt = _build_batch_prompt(batch_data)
            results = _call_gemini(api_key, api_version, model, prompt)

            if results is None:
                logger.warning(
                    "Gemini classification failed for batch of %d — falling back to full_house",
                    len(batch),
                )
                stats["fallback_count"] += len(batch)
                stats["errors"] += 1
                for l in batch:
                    l.listing_type = "full_house"
                    stats["classified"]["full_house"] += 1
                continue

            result_map = {r["id"]: r["type"] for r in results}

            for batch_idx, l in enumerate(batch):
                classified_type = result_map.get(batch_idx + 1)
                if classified_type and classified_type in VALID_TYPES:
                    l.listing_type = classified_type
                else:
                    l.listing_type = "full_house"
                    stats["fallback_count"] += 1

                stats["classified"][l.listing_type] += 1
                logger.info(
                    "Classified %s/%s as %s: %.80s",
                    l.source, l.source_id, l.listing_type,
                    l.title or l.body or "",
                )

    except Exception as e:
        logger.error("classify_listing_types failed: %s — all defaulting to full_house", e)
        stats["errors"] += 1
        unset = [l for l in listings if not hasattr(l, "listing_type") or l.listing_type == "full_house"]
        stats["fallback_count"] += len(unset)
        stats["classified"]["full_house"] = len(listings)

    return stats


def discard_not_a_listing(source: str, listings) -> int:
    """
    Post-upsert: set status='discarded' for rows classified as not_a_listing.

    Returns the number of rows updated.
    """
    not_listing_ids = [l.source_id for l in listings if l.listing_type == "not_a_listing"]
    if not not_listing_ids:
        return 0

    from ingestion.db import get_connection
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            UPDATE listings SET status = 'discarded'
            WHERE source = %s AND source_id = ANY(%s) AND status != 'discarded'
        """, (source, not_listing_ids))
        count = cur.rowcount
        conn.commit()
        logger.info("Marked %d not_a_listing rows as discarded (source=%s)", count, source)
        return count
    except Exception as e:
        logger.error("discard_not_a_listing failed: %s", e)
        conn.rollback()
        return 0
    finally:
        conn.close()
