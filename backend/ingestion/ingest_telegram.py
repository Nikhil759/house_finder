#!/usr/bin/env python3
"""
Telegram ingestion script.

Fetches rental listing messages from Bangalore Telegram groups via the
MTProto API (Telethon), parses structured fields with regex, normalizes
to StandardListing, and upserts to Supabase Postgres.

Usage:
    python -m ingestion.ingest_telegram          # from backend/
    python backend/ingestion/ingest_telegram.py  # from repo root
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from ingestion.models import StandardListing
from ingestion.db import (
    upsert_listings, mark_stale, record_run_start, record_run_end, UpsertStats,
)
from ingestion.scoring import compute_quality_score
from localities import normalize_locality, extract_locality

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ingest_telegram")

BANGALORE_TELEGRAM_GROUPS = [
    "HousingBangalore",
    "FlatsAndFlatmatesBangalore",
    "bangalorerentals",
    "bangalorerental1",
    "rentalsbangalore",
    "blrhousing",
    "HousingourBengaluru",
    "BangaloreHousing",
    "flatandflatmatebangalore",
]

RENT_KEYWORDS = [
    "rent", "bhk", "pg", "hostel", "flatmate",
    "available", "deposit", "furnished", "lease",
    "tenant", "flat for", "room for",
]

MESSAGES_PER_GROUP = 50
MAX_PER_GROUP = 15


# ── Parsing helpers ──

def _is_relevant(text: str) -> bool:
    if not text:
        return False
    lower = text.lower()
    return any(kw in lower for kw in RENT_KEYWORDS)


def _extract_price_int(text: str) -> int | None:
    for pattern in [
        r'rent[:\s*]+[₹rs\.]*\s*([\d,]+)',
        r'[₹rs\.]+\s*([\d,]+)\s*/?\s*month',
        r'[₹rs\.]+\s*([\d,]+)\s*(?:per month|pm|p\.m)',
    ]:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            try:
                return int(m.group(1).replace(",", ""))
            except ValueError:
                pass
    return None


def _extract_deposit(text: str) -> int | None:
    for pattern in [
        r'(?:total\s+)?deposit[:\s*]+[₹rs\.]*\s*([\d,]+)',
        r'(?:security\s+)?deposit[:\s*]+[₹rs\.]*\s*([\d,]+)',
        r'advance[:\s*]+[₹rs\.]*\s*([\d,]+)',
    ]:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            try:
                return int(m.group(1).replace(",", ""))
            except ValueError:
                pass
    return None


def _extract_bhk(text: str) -> str | None:
    m = re.search(r'(\d)\s*(?:BHK|bhk|bedroom|bed room)', text, re.IGNORECASE)
    if m:
        return f"{m.group(1)} BHK"
    if re.search(r'studio|1\s*rk', text, re.IGNORECASE):
        return "Studio/1RK"
    return None


def _extract_furnishing(text: str) -> str | None:
    if re.search(r'fully[\s-]furnished', text, re.IGNORECASE):
        return "Fully Furnished"
    if re.search(r'semi[\s-]furnished', text, re.IGNORECASE):
        return "Semi Furnished"
    if re.search(r'unfurnished|un-furnished', text, re.IGNORECASE):
        return "Unfurnished"
    return None


def _extract_contact(text: str) -> str | None:
    m = re.search(r'(?:\+?91[\s-]?)?([6-9]\d{9})', text)
    return m.group(1) if m else None


def _extract_maps_url(text: str) -> str | None:
    m = re.search(r'(https?://(?:maps\.app\.goo\.gl|goo\.gl/maps|maps\.google\.com)\S+)', text)
    return m.group(1) if m else None


def _extract_amenities(text: str) -> list[str]:
    patterns = {
        "Gym": r'\bgym\b', "Pool": r'\bpool\b|\bswimming\b',
        "Security": r'\bsecurity\b|\b24/7\b', "Parking": r'\bparking\b',
        "Wifi": r'\bwifi\b|\bwi-fi\b|\binternet\b',
        "Power Backup": r'\bpower[\s-]backup\b',
        "Lift": r'\blift\b|\belevator\b', "Gated": r'\bgated\b',
    }
    return [label for label, pat in patterns.items() if re.search(pat, text, re.IGNORECASE)]


def _is_flatmate(text: str) -> bool:
    return bool(re.search(
        r'flatmate|flat.?mate|roommate|room.?mate|room available|'
        r'single room|one room|1 room|sharing',
        text, re.IGNORECASE,
    ))


def _extract_title(text: str, bhk: str | None, furnishing: str | None, locality: str | None, rent: int | None) -> str:
    """Build the most informative title line from a Telegram message."""
    _GENERIC = re.compile(
        r"^\W*\d\s*(?:bhk?|bedroom)\s*(?:listing|available|flat|apartment|for\s*rent)?\W*$"
        r"|^\W*(?:flat|room|apartment|property)\s*(?:for\s*rent|available|listing)?\W*$"
        r"|^\W*(?:rent|rental|listing|post|announcement)\W*$",
        re.IGNORECASE,
    )
    _HEADER = re.compile(
        r"^(location|rent|deposit|contact|call|note|nearby|amenities|bhk|type|available)[:\s]",
        re.IGNORECASE,
    )
    for line in [l.strip() for l in text.split("\n") if l.strip()]:
        clean = re.sub(r"\*+|={3,}|#+|[🏠🏡🏢🔑✅📍💰🛋️]", "", line).strip()
        if len(clean) < 20 or _GENERIC.match(clean) or _HEADER.match(clean):
            continue
        return clean[:120]

    parts = [p for p in [bhk, furnishing, locality, f"₹{rent:,}/mo" if rent else None] if p]
    if parts:
        return " · ".join(parts)
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    return lines[0][:120] if lines else "Telegram listing"


async def fetch_all_groups() -> list[StandardListing]:
    """Fetch and normalize listings from all Telegram groups."""
    api_id = os.getenv("TELEGRAM_API_ID")
    api_hash = os.getenv("TELEGRAM_API_HASH")
    raw_session = os.getenv("TELEGRAM_SESSION_STRING") or ""
    session_string = re.sub(r"\s+", "", raw_session) or None
    session_name = os.getenv("TELEGRAM_SESSION_NAME", "housing_finder")

    if not api_id or not api_hash:
        logger.error("TELEGRAM_API_ID and TELEGRAM_API_HASH must be set")
        return []

    from telethon import TelegramClient
    from telethon.sessions import StringSession
    from telethon.errors import ChannelPrivateError, UsernameNotOccupiedError, FloodWaitError

    session = StringSession(session_string) if session_string else \
        os.path.join(os.path.dirname(__file__), "..", session_name)

    client = TelegramClient(session, int(api_id), api_hash)
    listings: list[StandardListing] = []

    try:
        await client.connect()
        if not await client.is_user_authorized():
            logger.error("Telegram session not authorized")
            return []

        for group in BANGALORE_TELEGRAM_GROUPS:
            try:
                messages = await client.get_messages(group, limit=MESSAGES_PER_GROUP)
                group_listings = []
                for msg in messages:
                    text = msg.text or ""
                    if not _is_relevant(text):
                        continue

                    rent = _extract_price_int(text)
                    deposit = _extract_deposit(text)
                    bhk = _extract_bhk(text)
                    furnishing = _extract_furnishing(text)
                    contact = _extract_contact(text)
                    locality = normalize_locality(text) or extract_locality(text)
                    maps_url = _extract_maps_url(text)
                    amenities = _extract_amenities(text)
                    flatmate = _is_flatmate(text)
                    no_brokerage = bool(re.search(r'no[\s-]brok(?:er|erage)', text, re.IGNORECASE))
                    title = _extract_title(text, bhk, furnishing, locality, rent)

                    listing = StandardListing(
                        source="telegram",
                        source_id=str(msg.id),
                        source_url=f"https://t.me/{group}/{msg.id}",
                        source_group=group,
                        title=title,
                        body=text[:2000],
                        bhk=bhk,
                        property_type="Flatmate" if flatmate else None,
                        furnishing=furnishing,
                        rent=rent,
                        deposit=deposit,
                        locality=locality,
                        maps_url=maps_url,
                        contact_phone=contact,
                        amenities=amenities,
                        no_brokerage=no_brokerage,
                        is_flatmate=flatmate,
                        posted_at=int(msg.date.timestamp()),
                        raw_payload={"text": text, "group": group, "sender_id": str(msg.sender_id or "")},
                    )
                    listing.quality_score = compute_quality_score(
                        source="telegram",
                        title=listing.title or "",
                        body=listing.body or "",
                        rent=listing.rent,
                        contact_phone=listing.contact_phone,
                        bhk=listing.bhk,
                        furnishing=listing.furnishing,
                        deposit=listing.deposit,
                        no_brokerage=listing.no_brokerage,
                        posted_at=listing.posted_at,
                    )
                    group_listings.append(listing)

                listings.extend(group_listings[:MAX_PER_GROUP])
                logger.info("  %s: %d relevant messages", group, len(group_listings))

            except (ChannelPrivateError, UsernameNotOccupiedError):
                logger.warning("  %s: cannot access, skipping", group)
            except FloodWaitError as e:
                logger.warning("  FloodWait %ds, stopping group iteration", e.seconds)
                break
            except Exception as e:
                logger.error("  %s: error — %s", group, e)
    finally:
        await client.disconnect()

    return listings


def main():
    started_at = datetime.now(timezone.utc)
    run_id = os.environ.get("GITHUB_RUN_ID")
    db_run_id = record_run_start("telegram", run_id)

    logger.info("Starting Telegram ingestion for %d groups", len(BANGALORE_TELEGRAM_GROUPS))

    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        all_listings = loop.run_until_complete(fetch_all_groups())
    except Exception as e:
        logger.error("Telegram fetch failed: %s", e)
        record_run_end(db_run_id, status="failed", error_message=str(e), started_at=started_at)
        return

    stats = UpsertStats()
    if all_listings:
        stats = upsert_listings(all_listings)

    stale_count = mark_stale("telegram", started_at)

    record_run_end(
        db_run_id,
        status="success",
        stats=stats,
        total_fetched=len(all_listings),
        total_stale=stale_count,
        started_at=started_at,
    )
    logger.info(
        "Telegram ingestion complete: %d fetched, %d new, %d updated, %d stale",
        len(all_listings), stats.total_new, stats.total_updated, stale_count,
    )


if __name__ == "__main__":
    main()
