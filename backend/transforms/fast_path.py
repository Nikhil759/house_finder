"""
Fast-path transforms — called at the end of each ingestion script's main().

Listings: run_post_ingest_transforms(source, started_at)
  - Stale marking (all sources)
  - Fuzzy locality matching (Reddit/Telegram only)
  - Listing filter + Gemini extraction (Reddit/Telegram only)

Pulse: run_post_pulse_transforms(source)
  - Gemini tagging (all sources)
  - Category filter (all sources)
  - News dedup (news source only)
"""

from __future__ import annotations

import logging
from datetime import datetime

from transforms.db import record_transform_start, record_transform_end

logger = logging.getLogger(__name__)

UNSTRUCTURED_SOURCES = ("reddit", "telegram")


# ─────────────────────────────────────────────
# Listings fast-path
# ─────────────────────────────────────────────

def run_post_ingest_transforms(source: str, started_at: datetime):
    """
    Called at the end of each listing ingestion script's main().
    Runs source-appropriate fast-path transforms.
    """
    logger.info("Running post-ingest transforms for %s", source)

    _run_stale_marking(source, started_at)

    if source in UNSTRUCTURED_SOURCES:
        _run_fuzzy_locality_matching(source)
        _run_listing_filter_and_extraction(source)

    logger.info("Post-ingest transforms complete for %s", source)


def _run_stale_marking(source: str, started_at: datetime):
    """Mark listings not seen in this cycle as stale/expired."""
    run_id = record_transform_start("stale_marking", source)
    try:
        from ingestion.db import mark_stale
        stale_count = mark_stale(source, started_at)
        record_transform_end(
            run_id,
            status="success",
            records_processed=stale_count,
            started_at=started_at,
            metadata={"stale_count": stale_count},
        )
        logger.info("Stale marking for %s: %d marked", source, stale_count)
    except Exception as e:
        logger.error("Stale marking failed for %s: %s", source, e)
        record_transform_end(
            run_id,
            status="failed",
            error_message=str(e),
            started_at=started_at,
        )


def _run_fuzzy_locality_matching(source: str):
    """
    Second-pass locality matching using rapidfuzz for Reddit/Telegram
    posts where the exact alias table didn't find a locality at ingest time.
    """
    from datetime import datetime, timezone
    started_at = datetime.now(timezone.utc)
    run_id = record_transform_start("fuzzy_locality", source)
    try:
        from transforms.locality_matcher import fuzzy_match_unmatched_listings
        processed, matched = fuzzy_match_unmatched_listings(source)
        record_transform_end(
            run_id,
            status="success",
            records_processed=processed,
            started_at=started_at,
            metadata={"matched": matched, "unmatched_remaining": processed - matched},
        )
        logger.info("Fuzzy locality for %s: %d/%d matched", source, matched, processed)
    except Exception as e:
        logger.error("Fuzzy locality matching failed for %s: %s", source, e)
        record_transform_end(run_id, status="failed", error_message=str(e), started_at=started_at)


def _run_listing_filter_and_extraction(source: str):
    """
    For Reddit/Telegram: detect non-listings + extract structured fields
    via Gemini Flash Lite.

    TODO (Phase 2): Implement Gemini batch extraction.
    """
    run_id = record_transform_start("listing_extraction", source)
    try:
        # Phase 2: implement listing filter + Gemini extraction here
        record_transform_end(
            run_id,
            status="success",
            records_processed=0,
            metadata={"note": "stub — implementation in Phase 2"},
        )
    except Exception as e:
        logger.error("Listing extraction failed for %s: %s", source, e)
        record_transform_end(run_id, status="failed", error_message=str(e))


# ─────────────────────────────────────────────
# Pulse fast-path
# ─────────────────────────────────────────────

def run_post_pulse_transforms(source: str):
    """
    Called at the end of each Pulse ingestion script's main().
    Runs source-appropriate fast-path transforms.
    """
    logger.info("Running post-pulse transforms for %s", source)

    _run_gemini_tagging(source)
    _run_category_filter(source)

    if source == "news":
        _run_news_dedup()

    logger.info("Post-pulse transforms complete for %s", source)


def _run_gemini_tagging(source: str):
    """
    Gemini Flash Lite batch tagging: category, topic, sentiment,
    locality NER, relevance. Already implemented in
    ingestion/tag_locality_feed.py — will be moved here in Phase 2.

    TODO (Phase 2): Move existing tagging logic here + add gemini_fallback tracking.
    """
    run_id = record_transform_start("gemini_tagging", source)
    try:
        # Phase 2: move tag_locality_feed.py logic here
        record_transform_end(
            run_id,
            status="success",
            records_processed=0,
            metadata={"note": "stub — implementation in Phase 2"},
        )
    except Exception as e:
        logger.error("Gemini tagging failed for %s: %s", source, e)
        record_transform_end(run_id, status="failed", error_message=str(e))


def _run_category_filter(source: str):
    """
    Exclude listing/flatmate_search/spam posts from the curated feed.

    TODO (Phase 2): Implement category filter into feed_curated.
    """
    run_id = record_transform_start("category_filter", source)
    try:
        # Phase 2: implement category filter here
        record_transform_end(
            run_id,
            status="success",
            records_processed=0,
            metadata={"note": "stub — implementation in Phase 2"},
        )
    except Exception as e:
        logger.error("Category filter failed for %s: %s", source, e)
        record_transform_end(run_id, status="failed", error_message=str(e))


def _run_news_dedup():
    """
    Near-duplicate news dedup (>85% title similarity).

    TODO (Phase 2): Implement title-similarity dedup for news articles.
    """
    run_id = record_transform_start("news_dedup", "news")
    try:
        # Phase 2: implement news dedup here
        record_transform_end(
            run_id,
            status="success",
            records_processed=0,
            metadata={"note": "stub — implementation in Phase 2"},
        )
    except Exception as e:
        logger.error("News dedup failed: %s", e)
        record_transform_end(run_id, status="failed", error_message=str(e))
