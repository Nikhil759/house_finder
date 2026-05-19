"""
Pulse fast-path + slow-path transforms.

Fast-path (called after each Pulse ingestion):
  1. Gemini tagging — delegates to existing tag_locality_feed logic
  2. Category filter — exclude listing/flatmate_search/spam from feed_curated
  3. News dedup — near-duplicate title detection (>85% similarity)

Slow-path (daily at 3:00 AM UTC):
  4. Trend detection — SQL ratio-based spike detection
  5. Editor/Curator Agent — Gemini Flash ranks top posts
  6. Gemini fallback re-processing
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import requests
from rapidfuzz import fuzz

from transforms.db import (
    get_connection,
    record_transform_start,
    record_transform_end,
)

logger = logging.getLogger(__name__)

GEMINI_BASE = "https://generativelanguage.googleapis.com"

CANDIDATE_MODELS_LITE = [
    ("v1beta", "gemini-2.5-flash-lite"),
    ("v1beta", "gemini-flash-lite-latest"),
]

CANDIDATE_MODELS_FLASH = [
    ("v1beta", "gemini-2.5-flash"),
    ("v1beta", "gemini-flash-latest"),
    ("v1beta", "gemini-2.0-flash"),
]

EXCLUDED_CATEGORIES = {"listing", "flatmate_search", "spam"}

NEWS_DEDUP_THRESHOLD = 85
NEWS_DEDUP_LOOKBACK_HOURS = 48


# ─────────────────────────────────────────────
# 1. Gemini Tagging (wraps existing logic)
# ─────────────────────────────────────────────

def run_gemini_tagging(source: str):
    """
    Run Gemini tagging on untagged locality_feed rows for this source.
    Delegates to the existing tag_locality_feed module.
    """
    started_at = datetime.now(timezone.utc)
    run_id = record_transform_start("gemini_tagging", source)

    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

        from ingestion.tag_locality_feed import (
            _get_api_key,
            _probe_model,
            fetch_canonical_topics,
            _build_prompt_header,
            fetch_untagged,
            call_gemini_batch,
            ensure_topic_exists,
            bulk_update,
        )
        from ingestion.db import get_connection as ing_get_connection

        api_key = _get_api_key()
        model_info = _probe_model(api_key)
        if model_info is None:
            raise RuntimeError("No working Gemini model found for tagging")

        api_version, model = model_info
        conn = ing_get_connection()

        canonical_topics = fetch_canonical_topics(conn)
        prompt_header = _build_prompt_header(canonical_topics)
        rows = fetch_untagged(conn)
        total = len(rows)

        if total == 0:
            logger.info("No untagged posts for %s", source)
            conn.close()
            record_transform_end(
                run_id, status="success",
                records_processed=0, started_at=started_at,
            )
            return

        results = call_gemini_batch(api_key, api_version, model, rows, prompt_header)

        known_topics = set(canonical_topics)
        for r in results:
            if r["canonical_topic"] not in known_topics:
                ensure_topic_exists(conn, r["canonical_topic"], known_topics)

        succeeded, failed = bulk_update(conn, results)

        gemini_fallback = sum(
            1 for r in results
            if r.get("category") == "discussion" and r.get("canonical_topic") == "other"
        )

        conn.close()

        record_transform_end(
            run_id, status="success",
            records_processed=total,
            records_failed=failed,
            gemini_calls=1,
            gemini_fallback_count=gemini_fallback,
            started_at=started_at,
            metadata={"succeeded": succeeded, "failed": failed},
        )
        logger.info("Gemini tagging for %s: %d tagged, %d failed", source, succeeded, failed)

    except Exception as e:
        logger.error("Gemini tagging failed for %s: %s", source, e)
        record_transform_end(
            run_id, status="failed", error_message=str(e), started_at=started_at,
        )


# ─────────────────────────────────────────────
# 2. Category Filter
# ─────────────────────────────────────────────

def run_category_filter(source: str):
    """
    Copy tagged locality_feed rows into feed_curated, excluding
    listing/flatmate_search/spam categories.
    """
    started_at = datetime.now(timezone.utc)
    run_id = record_transform_start("category_filter", source)

    try:
        conn = get_connection()
        cur = conn.cursor()

        cur.execute("""
            INSERT INTO feed_curated (feed_id, gemini_tagged, created_at, updated_at)
            SELECT lf.id, TRUE, NOW(), NOW()
            FROM locality_feed lf
            LEFT JOIN feed_curated fc ON fc.feed_id = lf.id
            WHERE lf.category IS NOT NULL
              AND lf.category NOT IN ('listing', 'flatmate_search', 'spam')
              AND fc.feed_id IS NULL
              AND lf.scraped_at > NOW() - INTERVAL '48 hours'
            ON CONFLICT (feed_id) DO NOTHING
        """)
        inserted = cur.rowcount

        conn.commit()
        conn.close()

        record_transform_end(
            run_id, status="success",
            records_processed=inserted,
            started_at=started_at,
        )
        logger.info("Category filter for %s: %d posts added to feed_curated", source, inserted)

    except Exception as e:
        logger.error("Category filter failed for %s: %s", source, e)
        record_transform_end(
            run_id, status="failed", error_message=str(e), started_at=started_at,
        )


# ─────────────────────────────────────────────
# 3. News Dedup
# ─────────────────────────────────────────────

def run_news_dedup():
    """
    Near-duplicate news article detection (>85% title similarity).
    Keeps the higher-engagement version, removes the duplicate from feed_curated.
    """
    started_at = datetime.now(timezone.utc)
    run_id = record_transform_start("news_dedup", "news")

    try:
        conn = get_connection()
        cur = conn.cursor()

        cur.execute("""
            SELECT lf.id, lf.title, lf.engagement
            FROM locality_feed lf
            JOIN feed_curated fc ON fc.feed_id = lf.id
            WHERE lf.source = 'news'
              AND lf.scraped_at > NOW() - INTERVAL '%s hours'
              AND lf.title IS NOT NULL
            ORDER BY lf.engagement DESC
        """, (NEWS_DEDUP_LOOKBACK_HOURS,))
        rows = cur.fetchall()

        duplicates_removed = 0
        seen_titles: list[tuple[int, str, int]] = []
        ids_to_remove: set[int] = set()

        for feed_id, title, engagement in rows:
            if feed_id in ids_to_remove:
                continue

            is_dup = False
            for seen_id, seen_title, seen_eng in seen_titles:
                similarity = fuzz.ratio(title.lower(), seen_title.lower())
                if similarity >= NEWS_DEDUP_THRESHOLD:
                    if engagement <= seen_eng:
                        ids_to_remove.add(feed_id)
                    else:
                        ids_to_remove.add(seen_id)
                    is_dup = True
                    break

            if not is_dup:
                seen_titles.append((feed_id, title, engagement))

        if ids_to_remove:
            cur.execute(
                "DELETE FROM feed_curated WHERE feed_id = ANY(%s)",
                (list(ids_to_remove),),
            )
            duplicates_removed = len(ids_to_remove)

        conn.commit()
        conn.close()

        record_transform_end(
            run_id, status="success",
            records_processed=len(rows),
            started_at=started_at,
            metadata={"duplicates_removed": duplicates_removed},
        )
        logger.info("News dedup: %d articles checked, %d duplicates removed", len(rows), duplicates_removed)

    except Exception as e:
        logger.error("News dedup failed: %s", e)
        record_transform_end(
            run_id, status="failed", error_message=str(e), started_at=started_at,
        )


# ─────────────────────────────────────────────
# 4. Trend Detection (slow-path)
# ─────────────────────────────────────────────

def run_trend_detection():
    """
    SQL-based trend detection: spike_ratio = recent_72h / (3 × 7day_daily_avg).
    Flags topics with spike_ratio >= 2.0 AND recent count >= 5.
    """
    started_at = datetime.now(timezone.utc)
    run_id = record_transform_start("trend_detection")

    try:
        conn = get_connection()
        cur = conn.cursor()

        cur.execute("""
            WITH recent AS (
                SELECT canonical_topic, COUNT(*) AS cnt_72h
                FROM locality_feed
                WHERE scraped_at > NOW() - INTERVAL '72 hours'
                  AND canonical_topic IS NOT NULL
                  AND category IN ('discussion', 'news')
                GROUP BY canonical_topic
            ),
            baseline AS (
                SELECT canonical_topic,
                       COUNT(*)::float / 7.0 AS daily_avg
                FROM locality_feed
                WHERE scraped_at > NOW() - INTERVAL '7 days'
                  AND canonical_topic IS NOT NULL
                  AND category IN ('discussion', 'news')
                GROUP BY canonical_topic
            )
            SELECT r.canonical_topic,
                   r.cnt_72h,
                   b.daily_avg,
                   CASE WHEN b.daily_avg > 0
                        THEN r.cnt_72h / (3.0 * b.daily_avg)
                        ELSE 0 END AS spike_ratio
            FROM recent r
            LEFT JOIN baseline b USING (canonical_topic)
            WHERE r.cnt_72h >= 5
        """)
        topic_spikes = cur.fetchall()

        cur.execute("""
            UPDATE feed_curated SET is_trending = FALSE, trending_score = NULL
            WHERE is_trending = TRUE
        """)
        cleared = cur.rowcount

        trending_count = 0
        for topic, cnt_72h, daily_avg, spike_ratio in topic_spikes:
            if spike_ratio and spike_ratio >= 2.0:
                cur.execute("""
                    UPDATE feed_curated fc SET
                        is_trending = TRUE,
                        trending_score = %s,
                        updated_at = NOW()
                    FROM locality_feed lf
                    WHERE fc.feed_id = lf.id
                      AND lf.canonical_topic = %s
                      AND lf.scraped_at > NOW() - INTERVAL '72 hours'
                      AND lf.category IN ('discussion', 'news')
                """, (float(spike_ratio), topic))
                trending_count += cur.rowcount

        conn.commit()
        conn.close()

        record_transform_end(
            run_id, status="success",
            records_processed=trending_count,
            started_at=started_at,
            metadata={
                "topics_checked": len(topic_spikes),
                "trending_posts_flagged": trending_count,
                "previously_trending_cleared": cleared,
            },
        )
        logger.info("Trend detection: %d posts flagged as trending", trending_count)

    except Exception as e:
        logger.error("Trend detection failed: %s", e)
        record_transform_end(
            run_id, status="failed", error_message=str(e), started_at=started_at,
        )


# ─────────────────────────────────────────────
# 5. Editor / Curator Agent (slow-path)
# ─────────────────────────────────────────────

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


def _probe_model(api_key: str, models: list[tuple[str, str]]) -> tuple[str, str] | None:
    payload = {
        "contents": [{"parts": [{"text": "Reply with: ok"}]}],
        "generationConfig": {"maxOutputTokens": 5},
    }
    for api_version, model in models:
        url = f"{GEMINI_BASE}/{api_version}/models/{model}:generateContent"
        try:
            resp = requests.post(url, params={"key": api_key}, json=payload, timeout=15)
            if resp.status_code == 200:
                return api_version, model
        except Exception:
            pass
    return None


def run_editor_agent():
    """
    Gemini Flash acts as a city editor, ranking the best posts from
    the last 24 hours for the curated feed.
    """
    started_at = datetime.now(timezone.utc)
    run_id = record_transform_start("editor_agent")

    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

        api_key = _get_api_key()
        model_info = _probe_model(api_key, CANDIDATE_MODELS_FLASH)
        if model_info is None:
            raise RuntimeError("No working Gemini Flash model found for editor agent")

        api_version, model = model_info
        conn = get_connection()
        cur = conn.cursor()

        cur.execute("""
            SELECT lf.id, lf.title, lf.body, lf.locality, lf.source,
                   lf.canonical_topic, lf.sentiment_score, lf.relevance_score
            FROM locality_feed lf
            JOIN feed_curated fc ON fc.feed_id = lf.id
            WHERE lf.scraped_at > NOW() - INTERVAL '24 hours'
              AND lf.relevance_score > 0.6
              AND lf.category IN ('discussion', 'news')
              AND (fc.featured IS NULL OR fc.featured = FALSE)
            ORDER BY (lf.sentiment_score * lf.relevance_score) DESC
            LIMIT 200
        """)
        pool = cur.fetchall()

        if len(pool) < 3:
            logger.info("Editor agent: pool too small (%d posts), skipping", len(pool))
            conn.close()
            record_transform_end(
                run_id, status="success",
                records_processed=0, started_at=started_at,
                metadata={"pool_size": len(pool), "skipped": True},
            )
            return

        cur.execute("""
            UPDATE feed_curated SET featured = FALSE, editor_rank = NULL, editor_note = NULL
            WHERE featured = TRUE
        """)

        prompt = _build_editor_prompt(pool)

        url = f"{GEMINI_BASE}/{api_version}/models/{model}:generateContent"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 4096},
        }

        gemini_calls = 1
        gemini_fallback = 0

        resp = requests.post(url, params={"key": api_key}, json=payload, timeout=120)
        if resp.status_code != 200:
            logger.error("Editor agent Gemini HTTP %d: %s", resp.status_code, resp.text[:300])
            gemini_fallback = 1
            conn.close()
            record_transform_end(
                run_id, status="partial",
                gemini_calls=gemini_calls,
                gemini_fallback_count=gemini_fallback,
                started_at=started_at,
                error_message=f"Gemini HTTP {resp.status_code}",
            )
            return

        raw = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        rankings = _parse_editor_response(raw, pool)

        update_cur = conn.cursor()
        featured_count = 0
        for r in rankings:
            update_cur.execute("""
                UPDATE feed_curated SET
                    featured = TRUE,
                    editor_rank = %s,
                    editor_note = %s,
                    updated_at = NOW()
                WHERE feed_id = %s
            """, (r["rank"], r["note"], r["feed_id"]))
            featured_count += 1

        conn.commit()
        conn.close()

        record_transform_end(
            run_id, status="success",
            records_processed=len(pool),
            gemini_calls=gemini_calls,
            gemini_fallback_count=gemini_fallback,
            started_at=started_at,
            metadata={
                "pool_size": len(pool),
                "featured_count": featured_count,
            },
        )
        logger.info("Editor agent: %d posts featured from pool of %d", featured_count, len(pool))

    except Exception as e:
        logger.error("Editor agent failed: %s", e)
        record_transform_end(
            run_id, status="failed", error_message=str(e), started_at=started_at,
        )


def _build_editor_prompt(pool: list[tuple]) -> str:
    header = """\
You are a city news editor for Bengaluru. From the posts below, pick the 10–15 most \
interesting and important ones for residents. Rank them 1 (best) to N.

For each selected post, return a JSON array element with:
- "id": the post number (integer)
- "rank": integer rank (1 = most important)
- "note": one-sentence rationale for why this is noteworthy

Criteria for selection:
- Directly affects residents' daily life (water, safety, rent changes, infra)
- Unique insight or breaking news
- High community engagement or strong sentiment
- Geographic diversity (don't pick 5 posts about the same locality)

Skip: generic complaints, repetitive topics, low-relevance chatter.

Return ONLY the JSON array. No markdown, no explanation.

Posts:
"""
    lines = []
    for i, row in enumerate(pool, start=1):
        feed_id, title, body, locality, source, topic, sent, rel = row
        title_short = (title or "")[:200]
        body_short = (body or "")[:300]
        lines.append(
            f"[{i}] Locality: {locality or 'General'} | Topic: {topic or 'unknown'} | "
            f"Sentiment: {sent or 0:.2f} | Source: {source}\n"
            f"Title: {title_short}\nBody: {body_short}"
        )

    return header + "\n\n".join(lines)


def _parse_editor_response(raw: str, pool: list[tuple]) -> list[dict]:
    text = _strip_fences(raw)
    try:
        items = json.loads(text)
        if not isinstance(items, list):
            raise ValueError("Expected JSON array")
    except Exception as e:
        logger.warning("Editor response parse failed (%s): %.200s", e, raw)
        return []

    index_map = {i + 1: row for i, row in enumerate(pool)}
    results = []

    for item in items:
        try:
            idx = int(item.get("id", -1))
            row = index_map.get(idx)
            if not row:
                continue
            results.append({
                "feed_id": row[0],
                "rank": int(item.get("rank", 99)),
                "note": str(item.get("note", ""))[:500],
            })
        except Exception as e:
            logger.warning("Editor item parse error: %s", e)

    results.sort(key=lambda x: x["rank"])
    return results


# ─────────────────────────────────────────────
# 6. Gemini Fallback Re-processing
# ─────────────────────────────────────────────

def run_gemini_fallback_reprocess():
    """
    Nightly job: retry gemini_fallback=true rows in both
    listings_curated and feed_curated.
    """
    started_at = datetime.now(timezone.utc)
    run_id = record_transform_start("gemini_fallback_reprocess")
    total_retried = 0

    try:
        from transforms.listing_extractor import extract_listings_batch

        for source in ("reddit", "telegram"):
            stats = extract_listings_batch(source)
            total_retried += stats.get("processed", 0)

        run_gemini_tagging("reddit_discussions")
        run_gemini_tagging("news")

        record_transform_end(
            run_id, status="success",
            records_processed=total_retried,
            started_at=started_at,
        )
        logger.info("Gemini fallback reprocess: %d records retried", total_retried)

    except Exception as e:
        logger.error("Gemini fallback reprocess failed: %s", e)
        record_transform_end(
            run_id, status="failed", error_message=str(e), started_at=started_at,
        )


# ─────────────────────────────────────────────
# Runner — called by Railway Cron at 3:00 AM UTC
# ─────────────────────────────────────────────

def main():
    """Run all Pulse slow-path transforms in order."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    logger.info("Starting Pulse slow-path transforms")

    run_trend_detection()
    run_editor_agent()
    run_gemini_fallback_reprocess()

    logger.info("Pulse slow-path transforms complete")

    from sync.trigger import trigger_sync_after_completion
    trigger_sync_after_completion(reason="pulse_transforms")


if __name__ == "__main__":
    main()
