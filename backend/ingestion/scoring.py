"""
Quality scoring for listings — shared across all ingestion scripts.

Produces a 0–100 score used for ranking search results.
"""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Optional

_BROKER_SIGNALS = [
    "brokerage", "broker fee", "commission", "site visit",
    "schedule a visit", "book now", "contact for details",
    "call for price", "multiple options", "many flats available",
    "we have", "our property", "agent",
]

_SPAM_SIGNALS = [
    "forward", "share this", "join our group", "whatsapp us",
    "visit our website", "call us", "dm for more",
]

_LOCALITY_KEYWORDS: Optional[set] = None


def _get_locality_keywords() -> set:
    """Lazy-load locality names to avoid import-time DB dependency."""
    global _LOCALITY_KEYWORDS
    if _LOCALITY_KEYWORDS is None:
        try:
            import sys, os
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
            from localities import get_all_locality_names_lower
            _LOCALITY_KEYWORDS = get_all_locality_names_lower()
        except ImportError:
            _LOCALITY_KEYWORDS = set()
    return _LOCALITY_KEYWORDS


def compute_quality_score(
    *,
    source: str,
    title: str = "",
    body: str = "",
    rent: Optional[int] = None,
    contact_phone: Optional[str] = None,
    bhk: Optional[str] = None,
    furnishing: Optional[str] = None,
    deposit: Optional[int] = None,
    no_brokerage: bool = False,
    posted_at: Optional[datetime] = None,
    status: str = "active",
    reddit_score: int = 0,
    reddit_comments: int = 0,
) -> int:
    """Compute a 0–100 quality score for a listing."""
    score = 0
    text = f"{title} {body}".lower()

    if rent:
        score += 20
    if contact_phone:
        score += 20

    localities = _get_locality_keywords()
    if any(loc in text for loc in localities):
        score += 15

    bhk_signals = ["1bhk", "2bhk", "3bhk", "1 bhk", "2 bhk", "3 bhk", "studio", "1rk"]
    if bhk or any(b in text for b in bhk_signals):
        score += 15

    if furnishing or any(f in text for f in ["furnished", "semi-furnished", "unfurnished"]):
        score += 5
    if deposit or any(d in text for d in ["deposit", "advance", "security"]):
        score += 5

    # Age bonus
    if posted_at:
        age = (datetime.now(timezone.utc) - posted_at).total_seconds()
        if age < 86400:
            score += 20
        elif age < 604800:
            score += 10
        elif age < 2592000:
            score += 5

    # Source-specific bonuses
    if source == "reddit":
        if reddit_score > 10:
            score += 10
        elif reddit_score > 3:
            score += 5
        if reddit_comments > 5:
            score += 5

    if source == "telegram":
        body_len = len(body)
        if body_len > 200:
            score += 10
        elif body_len > 100:
            score += 5
        elif body_len < 30:
            score -= 10
        if no_brokerage:
            score += 15

    if source in ("nobroker", "housing"):
        score += 15

    # Broker penalty
    broker_count = sum(1 for sig in _BROKER_SIGNALS if sig in text)
    if broker_count >= 2:
        score -= 20
    elif broker_count == 1:
        score -= 10

    # Spam penalty
    if any(sig in text for sig in _SPAM_SIGNALS):
        score -= 15

    # Status penalty
    if status == "stale":
        score -= 25
    elif status == "expired":
        score -= 50

    return max(0, min(100, score))
