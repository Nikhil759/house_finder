"""
Fast-path transforms — called at the end of each ingestion script's main().

Listings: run_post_ingest_transforms(source, started_at)
  - Stale marking (all sources)
  - Fuzzy locality matching (Reddit/Telegram only)
  - Listing filter + Gemini extraction (Reddit/Telegram only)

Pulse: run_post_pulse_transforms(source)
  - Gemini tagging (all sources)
  - Category filter (all sources)
  - News dedup (news, google_news_rss, citizen_matters — cross-source)
"""

from __future__ import annotations

import logging
from datetime import datetime

from transforms.db import record_transform_start, record_transform_end

logger = logging.getLogger(__name__)

UNSTRUCTURED_SOURCES = ("reddit", "telegram")
NEWS_LIKE_SOURCES = frozenset({"news", "google_news_rss", "citizen_matters"})


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
    For Reddit/Telegram: regex pre-filter + Gemini Flash Lite extraction.
    Determines is_listing, extracts bhk/rent/locality/furnishing/rent_type.
    """
    from datetime import datetime, timezone
    started_at = datetime.now(timezone.utc)
    run_id = record_transform_start("listing_extraction", source)
    try:
        from transforms.listing_extractor import extract_listings_batch
        stats = extract_listings_batch(source)
        record_transform_end(
            run_id,
            status="success",
            records_processed=stats["processed"],
            records_failed=stats["errors"],
            gemini_calls=stats["gemini_calls"],
            gemini_fallback_count=stats["gemini_fallback_count"],
            started_at=started_at,
            metadata={
                "listings_found": stats["listings_found"],
                "non_listings": stats["non_listings"],
                "regex_filtered": stats["regex_filtered"],
            },
        )
        logger.info(
            "Listing extraction for %s: %d processed, %d listings, %d non-listings, %d regex-filtered",
            source, stats["processed"], stats["listings_found"],
            stats["non_listings"], stats["regex_filtered"],
        )
    except Exception as e:
        logger.error("Listing extraction failed for %s: %s", source, e)
        record_transform_end(run_id, status="failed", error_message=str(e), started_at=started_at)


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

    if source in NEWS_LIKE_SOURCES:
        _run_news_dedup()

    logger.info("Post-pulse transforms complete for %s", source)


def _run_gemini_tagging(source: str):
    """
    Gemini Flash Lite batch tagging: category, topic, sentiment,
    locality NER, relevance. Delegates to pulse_transforms.
    """
    try:
        from transforms.pulse_transforms import run_gemini_tagging
        run_gemini_tagging(source)
    except Exception as e:
        logger.error("Gemini tagging failed for %s: %s", source, e)


def _run_category_filter(source: str):
    """
    Copy tagged posts into feed_curated, excluding listing/flatmate_search/spam.
    """
    try:
        from transforms.pulse_transforms import run_category_filter
        run_category_filter(source)
    except Exception as e:
        logger.error("Category filter failed for %s: %s", source, e)


def _run_news_dedup():
    """Near-duplicate news dedup (>85% title similarity)."""
    try:
        from transforms.pulse_transforms import run_news_dedup
        run_news_dedup()
    except Exception as e:
        logger.error("News dedup failed: %s", e)
