"""Ranking helpers for the city-wide Pulse feed."""

import math
from datetime import datetime, timezone

HIGH_SENTIMENT_THRESHOLD = 0.3
BALANCE_POSITIVE_THRESHOLD = 0.15
BALANCE_NEGATIVE_THRESHOLD = -0.15


def days_since_iso(iso_str):
    if not iso_str:
        return 999.0
    try:
        dt = datetime.fromisoformat(str(iso_str).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - dt
        return delta.total_seconds() / 86400.0
    except (ValueError, TypeError):
        return 999.0


def is_high_sentiment(score) -> bool:
    try:
        return abs(float(score or 0)) >= HIGH_SENTIMENT_THRESHOLD
    except (TypeError, ValueError):
        return False


def sentiment_bucket(score) -> str:
    try:
        s = float(score or 0)
    except (TypeError, ValueError):
        return "neutral"
    if s >= BALANCE_POSITIVE_THRESHOLD:
        return "positive"
    if s <= BALANCE_NEGATIVE_THRESHOLD:
        return "negative"
    return "neutral"


def attach_decay_scores(posts):
    for post in posts:
        days_old = days_since_iso(post.get("scraped_at"))
        post["_decay_score"] = (post.get("relevance_score") or 0) * math.exp(-0.5 * days_old)


def _strip_decay(posts):
    for post in posts:
        post.pop("_decay_score", None)
    return posts


def _fill_balanced(buckets, count):
    """Interleave positive, negative, and neutral posts toward a mixed feed."""
    if count <= 0:
        return []

    indices = {key: 0 for key in buckets}
    picked = []
    cycle = ("positive", "negative", "neutral")
    cycle_idx = 0
    idle_rounds = 0

    while len(picked) < count and idle_rounds < len(cycle):
        bucket = cycle[cycle_idx % len(cycle)]
        cycle_idx += 1
        idx = indices[bucket]
        items = buckets[bucket]
        if idx < len(items):
            picked.append(items[idx])
            indices[bucket] = idx + 1
            idle_rounds = 0
        else:
            idle_rounds += 1

    return picked


def rank_pulse_feed(posts, limit=50):
    """
    Featured editor picks first, then a balanced mix of high-|sentiment| posts.
    """
    attach_decay_scores(posts)

    featured = sorted(
        (p for p in posts if p.get("featured")),
        key=lambda p: (p.get("editor_rank") or 9999, -p["_decay_score"]),
    )
    non_featured = [p for p in posts if not p.get("featured")]
    high_sentiment = sorted(
        (p for p in non_featured if is_high_sentiment(p.get("sentiment_score"))),
        key=lambda p: -p["_decay_score"],
    )

    result = []
    seen_ids = set()

    for post in featured:
        post_id = post.get("id")
        if post_id in seen_ids:
            continue
        result.append(post)
        seen_ids.add(post_id)
        if len(result) >= limit:
            return _strip_decay(result)

    buckets = {"positive": [], "negative": [], "neutral": []}
    for post in high_sentiment:
        post_id = post.get("id")
        if post_id in seen_ids:
            continue
        buckets[sentiment_bucket(post.get("sentiment_score"))].append(post)

    for post in _fill_balanced(buckets, limit - len(result)):
        post_id = post.get("id")
        if post_id in seen_ids:
            continue
        result.append(post)
        seen_ids.add(post_id)

    if len(result) < limit:
        for post in high_sentiment:
            post_id = post.get("id")
            if post_id in seen_ids:
                continue
            result.append(post)
            seen_ids.add(post_id)
            if len(result) >= limit:
                break

    return _strip_decay(result[:limit])
