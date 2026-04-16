"""
Fuzzy locality matching for Reddit/Telegram listings that didn't get a
locality assigned during ingestion.

Uses rapidfuzz against the canonical alias table from localities.py.
"""

from __future__ import annotations

import logging
import sys
import os

from rapidfuzz import fuzz, process

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from localities import LOCALITY_ALIASES, LOCALITY_META

from transforms.db import get_connection

logger = logging.getLogger(__name__)

_ALIAS_LIST: list[str] = []
_ALIAS_TO_CANONICAL: dict[str, str] = {}

FUZZY_THRESHOLD = 80
MIN_TOKEN_LENGTH = 3


def _build_alias_index():
    """Build a flat list of all aliases for rapidfuzz matching."""
    global _ALIAS_LIST, _ALIAS_TO_CANONICAL
    if _ALIAS_LIST:
        return

    for alias, canonical in LOCALITY_ALIASES.items():
        if len(alias) >= MIN_TOKEN_LENGTH:
            _ALIAS_LIST.append(alias)
            _ALIAS_TO_CANONICAL[alias] = canonical

    for name in LOCALITY_META:
        lower = name.lower()
        if lower not in _ALIAS_TO_CANONICAL:
            _ALIAS_LIST.append(lower)
            _ALIAS_TO_CANONICAL[lower] = name


def fuzzy_match_text(text: str) -> str | None:
    """
    Try to extract a locality from free text using fuzzy matching.
    Returns canonical locality name or None.
    """
    _build_alias_index()
    if not text or len(text.strip()) < MIN_TOKEN_LENGTH:
        return None

    text_lower = text.lower()

    words = text_lower.split()
    candidates = []
    for i in range(len(words)):
        for length in (3, 2, 1):
            if i + length <= len(words):
                candidates.append(" ".join(words[i:i + length]))

    best_match = None
    best_score = 0

    for candidate in candidates:
        if len(candidate) < MIN_TOKEN_LENGTH:
            continue
        result = process.extractOne(
            candidate,
            _ALIAS_LIST,
            scorer=fuzz.ratio,
            score_cutoff=FUZZY_THRESHOLD,
        )
        if result and result[1] > best_score:
            best_match = _ALIAS_TO_CANONICAL[result[0]]
            best_score = result[1]

    return best_match


def fuzzy_match_unmatched_listings(source: str) -> tuple[int, int]:
    """
    Find listings from the given source where locality IS NULL,
    attempt fuzzy matching on title + body, and update the locality.

    Returns (total_processed, total_matched).
    """
    conn = get_connection()
    processed = 0
    matched = 0

    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT id, title, body
            FROM listings
            WHERE source = %s
              AND locality IS NULL
              AND status = 'active'
        """, (source,))
        rows = cur.fetchall()
        processed = len(rows)

        if not rows:
            logger.info("No unmatched listings for %s", source)
            return (0, 0)

        logger.info("Fuzzy matching %d unmatched listings for %s", len(rows), source)

        update_cur = conn.cursor()
        for listing_id, title, body in rows:
            text = f"{title or ''} {body or ''}"
            locality = fuzzy_match_text(text)
            if locality:
                update_cur.execute(
                    "UPDATE listings SET locality = %s WHERE id = %s",
                    (locality, listing_id),
                )
                matched += 1

        conn.commit()
        logger.info("Fuzzy matched %d/%d listings for %s", matched, processed, source)
    except Exception as e:
        logger.error("fuzzy_match_unmatched_listings failed: %s", e)
        conn.rollback()
        raise
    finally:
        conn.close()

    return (processed, matched)
