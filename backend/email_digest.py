"""
NestIQ — New Listings Digest cron job.

Evaluates each subscribed user's frequency and interest areas, then sends
a curated digest email if conditions are met.

Run via Railway Cron:  30 2 * * *  (→ 8:00 AM IST daily)
Usage:  python -m email_digest
"""

from __future__ import annotations

import logging
import os
import time
from collections import defaultdict
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from email_service import (
    build_digest_subject,
    posthog_capture,
    send_digest_email,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("email_digest")

MIN_LISTINGS = 3
MAX_LISTINGS_PER_EMAIL = 15

FREQUENCY_HOURS = {
    "daily": 24,
    "every_3_days": 72,
    "every_5_days": 120,
    "weekly": 168,
}


def _get_conn():
    url = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("SUPABASE_DB_URL or DATABASE_URL must be set")
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return psycopg2.connect(url)


def _get_eligible_users(conn) -> list[dict]:
    """Fetch all users eligible for a digest (subscribed, not bounced, not spam)."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT user_id, email, new_listings_frequency,
                   last_digest_sent_at, created_at, disabled_localities
            FROM email_subscriptions
            WHERE new_listings_email_subscribed = true
              AND all_emails_unsubscribed = false
              AND hard_bounce_at IS NULL
              AND spam_complaint_at IS NULL
        """)
        return [dict(r) for r in cur.fetchall()]


def _frequency_elapsed(user: dict, now: datetime) -> bool:
    """Check whether enough time has passed since the last digest."""
    freq = user["new_listings_frequency"]
    last = user["last_digest_sent_at"]
    if last is None:
        return True
    hours = FREQUENCY_HOURS.get(freq, 24)
    elapsed = (now - last).total_seconds() / 3600
    return elapsed >= hours


def _get_interest_areas(conn, user_id: str) -> list[str]:
    """Derive a user's interest localities from saved_searches + user_preferences."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT loc FROM (
                SELECT location AS loc FROM saved_searches
                WHERE user_id = %s AND location IS NOT NULL AND location != ''
                UNION
                SELECT default_location AS loc FROM user_preferences
                WHERE user_id = %s AND default_location IS NOT NULL AND default_location != ''
            ) AS areas
        """, (str(user_id), str(user_id)))
        return [row[0] for row in cur.fetchall()]


def _get_new_listings(conn, localities: list[str], since: datetime, limit: int) -> list[dict]:
    """Fetch new listings in given localities since a timestamp."""
    if not localities:
        return []

    placeholders = ",".join(["%s"] * len(localities))
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(f"""
            SELECT l.id, l.source, l.source_id, l.title, l.bhk,
                   l.locality, l.rent, l.area_sqft,
                   COALESCE(lc.quality_score, l.quality_score) AS quality_score,
                   l.posted_at
            FROM listings l
            LEFT JOIN listings_curated lc ON lc.listing_id = l.id
            WHERE l.status = 'active'
              AND LOWER(l.locality) IN ({placeholders})
              AND l.posted_at > %s
              AND (l.rent IS NULL OR (l.rent >= 2000 AND l.rent <= 150000))
              AND (l.duplicate_group_id IS NULL OR l.id = l.duplicate_group_id)
              AND (lc.is_listing IS NULL OR lc.is_listing = TRUE)
            ORDER BY COALESCE(lc.quality_score, l.quality_score) DESC NULLS LAST
            LIMIT %s
        """, [loc.lower() for loc in localities] + [since, limit])
        return [dict(r) for r in cur.fetchall()]


def _count_new_listings(conn, localities: list[str], since: datetime) -> int:
    """Count total new listings (for the 'See all N' overflow link)."""
    if not localities:
        return 0
    placeholders = ",".join(["%s"] * len(localities))
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT COUNT(*)
            FROM listings l
            LEFT JOIN listings_curated lc ON lc.listing_id = l.id
            WHERE l.status = 'active'
              AND LOWER(l.locality) IN ({placeholders})
              AND l.posted_at > %s
              AND (l.rent IS NULL OR (l.rent >= 2000 AND l.rent <= 150000))
              AND (l.duplicate_group_id IS NULL OR l.id = l.duplicate_group_id)
              AND (lc.is_listing IS NULL OR lc.is_listing = TRUE)
        """, [loc.lower() for loc in localities] + [since])
        return cur.fetchone()[0]


def _get_saved_locality_order(conn, user_id: str, localities: list[str]) -> list[str]:
    """Order localities by how many listings the user has saved in each (most-saved first)."""
    if not localities:
        return []
    with conn.cursor() as cur:
        cur.execute("""
            SELECT listing_snapshot->>'locality' AS loc, COUNT(*) AS cnt
            FROM saved_listings
            WHERE user_id = %s
              AND listing_snapshot->>'locality' IS NOT NULL
            GROUP BY loc
            ORDER BY cnt DESC
        """, (str(user_id),))
        saved_order = [row[0].lower() for row in cur.fetchall()]

    loc_lower = {l.lower(): l for l in localities}
    ordered = []
    for so in saved_order:
        if so in loc_lower:
            ordered.append(loc_lower.pop(so))
    for remaining in loc_lower.values():
        ordered.append(remaining)
    return ordered


def _group_listings_by_locality(
    listings: list[dict], locality_order: list[str]
) -> dict[str, list]:
    """Group listings by locality, following the preferred order."""
    by_loc: dict[str, list] = defaultdict(list)
    for listing in listings:
        loc = listing.get("locality") or "Other"
        by_loc[loc].append(listing)

    # Reorder to match locality_order
    order_lower = {l.lower(): l for l in locality_order}
    ordered: dict[str, list] = {}
    for loc_lower, loc_display in order_lower.items():
        for key in list(by_loc.keys()):
            if key.lower() == loc_lower:
                ordered[key] = by_loc.pop(key)
                break
    for key, val in by_loc.items():
        ordered[key] = val
    return ordered


def _format_listing_id(listing: dict) -> str:
    return f"{listing['source']}_{listing['source_id']}"


def run_digest():
    """Main entry point: evaluate all users and send digests."""
    start = time.time()
    now = datetime.now(timezone.utc)

    conn = _get_conn()
    try:
        users = _get_eligible_users(conn)
        log.info("Found %d eligible users", len(users))

        stats = {"evaluated": 0, "sent": 0, "skipped_freq": 0, "skipped_areas": 0, "skipped_listings": 0, "errors": 0}

        for user in users:
            stats["evaluated"] += 1
            user_id = str(user["user_id"])
            email = user["email"]

            if not _frequency_elapsed(user, now):
                stats["skipped_freq"] += 1
                continue

            areas = _get_interest_areas(conn, user_id)
            disabled = set((d or "").lower() for d in (user.get("disabled_localities") or []))
            areas = [a for a in areas if a.lower() not in disabled]
            if not areas:
                stats["skipped_areas"] += 1
                continue

            since = user["last_digest_sent_at"] or user["created_at"]
            total_count = _count_new_listings(conn, areas, since)

            if total_count < MIN_LISTINGS:
                stats["skipped_listings"] += 1
                continue

            listings = _get_new_listings(conn, areas, since, MAX_LISTINGS_PER_EMAIL)
            for listing in listings:
                listing["id"] = _format_listing_id(listing)

            locality_order = _get_saved_locality_order(conn, user_id, areas)
            grouped = _group_listings_by_locality(listings, locality_order)

            ok, detail = send_digest_email(
                to_email=email,
                user_id=user_id,
                listings_by_locality=grouped,
                total_available=total_count,
                current_frequency=user["new_listings_frequency"],
            )

            if ok:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE email_subscriptions SET last_digest_sent_at = NOW(), updated_at = NOW() WHERE user_id = %s",
                        (user_id,),
                    )
                conn.commit()
                stats["sent"] += 1

                posthog_capture(user_id, "email_alert_sent", {
                    "type": "new_listings_digest",
                    "listing_count": len(listings),
                    "total_available": total_count,
                    "frequency": user["new_listings_frequency"],
                    "localities": areas,
                })
                log.info("Sent digest to %s (%d listings)", email, len(listings))
            else:
                stats["errors"] += 1
                log.warning("Failed to send digest to %s: %s", email, detail)

        elapsed = time.time() - start
        log.info(
            "Digest run complete in %.1fs — evaluated=%d sent=%d skipped(freq=%d areas=%d listings=%d) errors=%d",
            elapsed, stats["evaluated"], stats["sent"],
            stats["skipped_freq"], stats["skipped_areas"], stats["skipped_listings"],
            stats["errors"],
        )
    finally:
        conn.close()


if __name__ == "__main__":
    run_digest()
