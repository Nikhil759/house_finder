#!/usr/bin/env python3
"""
99acres ingestion script.

Scrapes rental listings from 99acres SRP pages by parsing the JSON-LD
structured data embedded in each page's HTML.  No API keys or auth tokens
needed — 99acres server-side-renders listing data inside
<script type="application/ld+json"> tags.

Usage:
    python -m ingestion.ingest_99acres          # from backend/
    python backend/ingestion/ingest_99acres.py  # from repo root

Environment:
    SUPABASE_DB_URL  — Supabase Postgres connection string (required)
    GITHUB_RUN_ID    — set automatically by GitHub Actions (optional)
    ACRES_MAX_PAGES  — override max pages per locality (default 5)
    ACRES_TEST_LOCALITY — scrape only one named locality (for testing)
"""

from __future__ import annotations

import json
import logging
import os
import random
import re
import sys
import time
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup

try:
    # curl_cffi impersonates Chrome's exact TLS/HTTP2 fingerprint (JA3/JA4),
    # which bypasses Cloudflare's bot detection more reliably than cloudscraper.
    from curl_cffi import requests as _cffi_requests
    _HAS_CURL_CFFI = True
except ImportError:
    _HAS_CURL_CFFI = False

try:
    import cloudscraper as _cloudscraper
    _HAS_CLOUDSCRAPER = True
except ImportError:
    _HAS_CLOUDSCRAPER = False

# Allow running as both `python -m ingestion.ingest_99acres` and direct script
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from ingestion.models import StandardListing
from ingestion.db import (
    upsert_listings, record_run_start, record_run_end, UpsertStats,
)
from localities import extract_locality

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ingest_99acres")

# ── Constants ──────────────────────────────────────────────────────────────────

SOURCE = "99acres"
MAX_PAGES = int(os.environ.get("ACRES_MAX_PAGES", "5"))

LOCALITY_SLUGS: dict[str, str] = {
    # ── East ──────────────────────────────────────────────────────────────────
    "Whitefield":        "whitefield-bangalore-east-ffid",
    "Indiranagar":       "indiranagar-bangalore-east-ffid",
    "Marathahalli":      "marathahalli-bangalore-east-ffid",
    "Sarjapur Road":     "sarjapur-road-bangalore-east-ffid",
    "Hoodi":             "hoodi-bangalore-east-ffid",
    "Banaswadi":         "banaswadi-bangalore-east-ffid",
    "KR Puram":          "kr-puram-bangalore-east-ffid",
    # ── South ─────────────────────────────────────────────────────────────────
    "Koramangala":       "koramangala-bangalore-south-ffid",
    "HSR Layout":        "hsr-layout-bangalore-south-ffid",
    "Bellandur":         "bellandur-bangalore-south-ffid",
    "BTM Layout":        "btm-layout-bangalore-south-ffid",
    "Electronic City":   "electronic-city-bangalore-south-ffid",
    "Jayanagar":         "jayanagar-bangalore-south-ffid",
    "JP Nagar":          "jp-nagar-bangalore-south-ffid",
    "Bannerghatta Road": "bannerghatta-road-bangalore-south-ffid",
    "Bommanahalli":      "bommanahalli-bangalore-south-ffid",
    "Banashankari":      "banashankari-bangalore-south-ffid",
    # ── North ─────────────────────────────────────────────────────────────────
    "Hebbal":            "hebbal-bangalore-north-ffid",
    "Yelahanka":         "yelahanka-bangalore-north-ffid",
    # ── Northwest / West (use search-URL format — no ffid SRP exists) ─────────
    "HBR Layout":        "_search_hbr-layout-bangalore",
    "Rajajinagar":       "_search_rajajinagar-bangalore",
    "Malleshwaram":      "_search_malleshwaram-bangalore-north",
    "Yeshwanthpur":      "_search_yeshwanthpur-bangalore",
}

# Localities whose SRP pages live under the search URL format rather than the
# canonical /property-for-rent-in-{slug}-ffid path.  Values are the base query
# string (without &page=N) that gets appended for these localities.
_SEARCH_URL_BASES: dict[str, str] = {
    "_search_hbr-layout-bangalore":        "https://www.99acres.com/search/property/rent/hbr-layout-bangalore?city=22&locality=5260&preference=R&area_unit=1&budget_min=0&res_com=R&isPreLeased=N",
    "_search_rajajinagar-bangalore":        "https://www.99acres.com/search/property/rent/rajajinagar-bangalore?city=252&locality=2367&preference=R&area_unit=1&budget_min=0&res_com=R&isPreLeased=N",
    "_search_malleshwaram-bangalore-north": "https://www.99acres.com/search/property/rent/malleshwaram-bangalore-north?city=21&locality=358&preference=R&area_unit=1&budget_min=0&res_com=R&isPreLeased=N",
    "_search_yeshwanthpur-bangalore":       "https://www.99acres.com/search/property/rent/yeshwanthpur-bangalore?city=252&locality=7973&preference=R&area_unit=1&budget_min=0&res_com=R&isPreLeased=N",
}

# JSON-LD @type values that represent individual property listings.
# ItemList, BreadcrumbList, WebPage, etc. are skipped.
_LISTING_TYPES = {"Apartment", "SingleFamilyResidence", "Residence", "House"}

# Headers added on top of whatever the session already has.
# When using cloudscraper the User-Agent is intentionally omitted here —
# cloudscraper sets its own UA as part of the browser fingerprint and
# overriding it breaks the Cloudflare challenge bypass.
_EXTRA_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.google.com/",
}

# Plain-requests fallback also sets a UA
_PLAIN_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    **_EXTRA_HEADERS,
}


# ── HTTP session ──────────────────────────────────────────────────────────────

def _build_session():
    """
    Build the HTTP session used for all 99acres requests.

    99acres uses Cloudflare with TLS fingerprinting (JA3/JA4).  A plain
    requests.Session or even cloudscraper will 403 because Python's ssl
    module has a different TLS handshake than Chrome.

    Preference order:
      1. curl_cffi  — uses libcurl with BoringSSL to produce the exact same
                       TLS/HTTP2 fingerprint as a real Chrome browser.
                       This is the most reliable bypass.
      2. cloudscraper — JS-challenge solver; works for some CF configs.
      3. requests.Session — last resort fallback.

    The session hits the homepage once so Cloudflare can issue
    a cf_clearance cookie before SRP page requests begin.
    """
    proxy_url = os.environ.get("ACRES_PROXY_URL", "").strip()

    if _HAS_CURL_CFFI:
        session = _cffi_requests.Session(impersonate="chrome124")
        # curl_cffi manages its own UA; only add non-fingerprint headers
        session.headers.update(_EXTRA_HEADERS)
        if proxy_url:
            session.proxies = {"http": proxy_url, "https": proxy_url}
        logger.info("Using curl_cffi session (Chrome TLS fingerprint)")

    elif _HAS_CLOUDSCRAPER:
        session = _cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "darwin", "mobile": False},
            delay=10,
        )
        session.headers.update(_EXTRA_HEADERS)
        if proxy_url:
            session.proxies = {"http": proxy_url, "https": proxy_url}
        logger.info("Using cloudscraper session (JS challenge bypass)")

    else:
        session = requests.Session()
        session.headers.update(_PLAIN_HEADERS)
        if proxy_url:
            session.proxies = {"http": proxy_url, "https": proxy_url}
        logger.warning("No bypass library found — install curl-cffi for best results")

    if proxy_url:
        logger.info("Using proxy: %s", proxy_url.split("@")[-1])

    # Homepage warmup: acquire cf_clearance cookie before hitting SRP pages
    try:
        warmup = session.get("https://www.99acres.com/", timeout=25)
        logger.info("Homepage warmup: HTTP %d", warmup.status_code)
    except Exception as e:
        logger.warning("Homepage warmup failed (non-fatal): %s", e)

    return session


# ── HTTP fetch ─────────────────────────────────────────────────────────────────

def _build_url(slug: str, page: int) -> str:
    if slug in _SEARCH_URL_BASES:
        # Search-format URL — params already in the base; append &page=N for p>1
        base = _SEARCH_URL_BASES[slug]
        return base if page == 1 else f"{base}&page={page}"
    # Standard SRP format: /property-for-rent-in-{slug}-ffid
    base = f"https://www.99acres.com/property-for-rent-in-{slug}"
    return base if page == 1 else f"{base}?page={page}"


def _parse_rent_action_price(price_str: str) -> int | None:
    """
    Parse the price string from a RentAction.priceSpecification.price field.
    Handles formats like "65,500" (plain rupees) and "1.8 L" (lakhs).
    """
    if not price_str:
        return None
    price_str = price_str.strip()
    # "1.8 L" or "1.8L" → lakhs
    m = re.match(r"([\d.]+)\s*L\b", price_str, re.IGNORECASE)
    if m:
        return int(float(m.group(1)) * 100_000)
    # Plain number with optional commas e.g. "65,500"
    m = re.match(r"[\d,]+$", price_str.replace(" ", ""))
    if m:
        try:
            return int(price_str.replace(",", "").replace(" ", ""))
        except ValueError:
            return None
    return None


def fetch_page(session: requests.Session, slug: str, page: int) -> list[dict]:
    """
    GET one SRP page and return all JSON-LD objects whose @type is a known
    listing type.  Returns an empty list on HTTP failure, Cloudflare block,
    or when no matching objects are found (signals end of pagination).

    Each returned dict has an optional injected key ``_rent_action_price``
    (int | None) sourced from the co-indexed RentAction JSON-LD object, which
    is more reliable than the description-regex price.
    """
    url = _build_url(slug, page)
    try:
        resp = session.get(url, timeout=25)
    except Exception as e:
        logger.error("  Request error %s page %d: %s", slug, page, e)
        return []

    if resp.status_code == 403:
        if not _HAS_CURL_CFFI:
            cf_hint = " — install curl-cffi for TLS fingerprint bypass"
        else:
            cf_hint = " — IP may be on Cloudflare blocklist; set ACRES_PROXY_URL"
        logger.warning("  403 on %s page %d — Cloudflare block%s", slug, page, cf_hint)
        return []

    if not resp.ok:
        logger.error("  HTTP %d for %s (page %d) — URL: %s", resp.status_code, slug, page, url)
        return []

    soup = BeautifulSoup(resp.text, "lxml")
    results: list[dict] = []
    rent_action_prices: list[int | None] = []

    for tag in soup.find_all("script", type="application/ld+json"):
        raw = (tag.string or "").strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue

        # Handle both a bare object and a JSON array of objects
        items = data if isinstance(data, list) else [data]
        for item in items:
            if not isinstance(item, dict):
                continue
            t = item.get("@type")
            if t in _LISTING_TYPES:
                results.append(item)
            elif t == "RentAction":
                price_spec = item.get("priceSpecification") or {}
                price_raw = price_spec.get("price") or price_spec.get("minPrice")
                rent_action_prices.append(_parse_rent_action_price(str(price_raw)) if price_raw else None)

    # Pair each listing with its co-indexed RentAction price (if available)
    for i, listing in enumerate(results):
        ra_price = rent_action_prices[i] if i < len(rent_action_prices) else None
        listing["_rent_action_price"] = ra_price

    if not results:
        logger.debug("  No JSON-LD listing objects on %s page %d", slug, page)

    return results


# ── Field-extraction helpers ───────────────────────────────────────────────────

def _extract_source_id(url: str) -> str | None:
    """
    Pull the SPID from a 99acres detail URL.
    Pattern: '...spid-W89948602...' → 'W89948602'
    Falls back to the last non-empty path segment for non-standard URLs.
    """
    m = re.search(r"spid-([A-Z0-9]+)", url or "", re.IGNORECASE)
    if m:
        return m.group(1).upper()
    # Fallback: last path segment, strip query string
    path = url.split("?")[0].rstrip("/")
    segment = path.split("/")[-1] if path else None
    return segment if segment and len(segment) > 4 else None


def _parse_floor_size(floor_size) -> int | None:
    """'1400 sq.ft.' or {'value': '1400 sq.ft.'} → 1400"""
    if isinstance(floor_size, dict):
        floor_size = floor_size.get("value") or floor_size.get("@value")
    if not floor_size:
        return None
    m = re.search(r"([\d,]+)", str(floor_size))
    if m:
        try:
            return int(m.group(1).replace(",", ""))
        except ValueError:
            return None
    return None


def _parse_price(text: str, patterns: list[str]) -> int | None:
    """Try each regex, return the first numeric match as int."""
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            raw = m.group(1).replace(",", "").strip()
            try:
                v = int(raw)
                return v if v > 0 else None
            except ValueError:
                continue
    return None


# Rent: look for explicit ₹ amounts or "X monthly/per month" phrasing
_RENT_PATTERNS = [
    r"₹\s*([\d,]+)\s*(?:per\s*month|monthly|/\s*month|pm\b)",
    r"([\d,]+)\s*(?:per\s*month|monthly|/\s*month|pm\b)",
    r"rent(?:al)?\s+(?:of\s+)?(?:is\s+)?(?:rs\.?\s*|₹\s*)?([\d,]+)",
    r"(?:rs\.?\s*|₹\s*)([\d,]+)\s*(?:per\s*month|/mo|monthly)",
]

# Deposit: look for "X as initial payment", "deposit of X", etc.
_DEPOSIT_PATTERNS = [
    r"([\d,]+)\s+is\s+required\s+to\s+be\s+paid\s+as\s+the\s+initial\s+payment",
    r"initial\s+(?:deposit|payment)\s+(?:of\s+)?(?:rs\.?\s*|₹\s*)?([\d,]+)",
    r"security\s+deposit\s+(?:of\s+)?(?:rs\.?\s*|₹\s*)?([\d,]+)",
    r"deposit\s+(?:of\s+)?(?:rs\.?\s*|₹\s*)?([\d,]+)",
    r"(?:rs\.?\s*|₹\s*)([\d,]+)\s+(?:as\s+)?(?:security\s+)?deposit",
]

# Maintenance: "X monthly maintenance" or "maintenance of X"
_MAINTENANCE_PATTERNS = [
    r"([\d,]+)\s*(?:per\s*month\s*)?(?:monthly\s+)?maintenance",
    r"maintenance\s+(?:of\s+)?(?:rs\.?\s*|₹\s*)?([\d,]+)",
]

_BROKER_RE = re.compile(
    r"\b(broker|dealer|agent|brokerage|prop(?:erty)?\s+dealer)\b", re.IGNORECASE
)
_OWNER_RE = re.compile(
    r"\b(owner|no[\s\-]*brok(?:er|erage)|direct\s+owner|without\s+brok(?:er|erage))\b",
    re.IGNORECASE,
)
_NO_BROKERAGE_RE = re.compile(r"\bno[\s\-]*brokerage\b", re.IGNORECASE)


def _parse_furnishing(text: str) -> str | None:
    t = text.lower()
    if "fully furnished" in t or "fully-furnished" in t:
        return "Fully Furnished"
    if "semi-furnished" in t or "semi furnished" in t:
        return "Semi Furnished"
    if "unfurnished" in t:
        return "Unfurnished"
    return None


def _property_type_map(schema_type: str) -> str:
    return "house" if schema_type == "SingleFamilyResidence" else "flat"


# ── Normalise ─────────────────────────────────────────────────────────────────

def normalize(item: dict, locality_name: str) -> StandardListing | None:
    """
    Convert one JSON-LD listing object to a StandardListing.
    Returns None if a stable source_id cannot be extracted.
    """
    url = item.get("url") or ""
    source_id = _extract_source_id(url)
    if not source_id:
        logger.debug("  Skipping item with no extractable ID: %.80s", url)
        return None

    name: str = item.get("name") or ""
    description: str = item.get("description") or ""

    # ── BHK ──
    rooms = item.get("numberOfRooms")
    if rooms is not None:
        try:
            bhk: str | None = f"{int(rooms)} BHK"
        except (ValueError, TypeError):
            bhk = None
    else:
        m = re.search(r"(\d)\s*BHK", name, re.IGNORECASE)
        if m:
            bhk = f"{m.group(1)} BHK"
        elif re.search(r"studio|1\s*rk", name, re.IGNORECASE):
            bhk = "Studio/1RK"
        else:
            # Last resort: look in description
            m2 = re.search(r"(\d)\s*BHK", description, re.IGNORECASE)
            bhk = f"{m2.group(1)} BHK" if m2 else None

    # ── Area ──
    area_sqft = _parse_floor_size(item.get("floorSize"))

    # ── Floor ──
    floor_raw = item.get("floorlevel")
    floor_info = str(floor_raw).strip() if floor_raw is not None else None

    # ── Coordinates — treat 0.0 as absent ──
    geo = item.get("geo") or {}
    try:
        lat_raw = float(geo.get("latitude") or 0)
        lat: float | None = lat_raw if lat_raw != 0.0 else None
    except (ValueError, TypeError):
        lat = None
    try:
        lng_raw = float(geo.get("longitude") or 0)
        lng: float | None = lng_raw if lng_raw != 0.0 else None
    except (ValueError, TypeError):
        lng = None

    # ── Address / locality ──
    addr_obj = item.get("address") or {}
    address = addr_obj.get("streetAddress") or ""
    canonical_locality = (
        extract_locality(address)
        or extract_locality(locality_name)
        or locality_name
    )

    # ── Property type ──
    property_type = _property_type_map(item.get("@type", ""))

    # ── Price fields ──
    # Prefer the structured RentAction price (injected by fetch_page) — it is the
    # canonical price shown on the 99acres card, not a regex over freeform text.
    rent_action_price: int | None = item.get("_rent_action_price")
    rent = rent_action_price or _parse_price(description, _RENT_PATTERNS)
    deposit = _parse_price(description, _DEPOSIT_PATTERNS)
    maintenance = _parse_price(description, _MAINTENANCE_PATTERNS)

    # Sanity-cap deposit: reject regex misfires where deposit > 12× rent.
    # Legitimate Bangalore deposits are typically 2–6 months; 12 is a safe ceiling.
    if deposit and rent and deposit > rent * 12:
        deposit = None

    # ── Furnishing ──
    furnishing = _parse_furnishing(description) or _parse_furnishing(name)

    # ── Broker / brokerage flags ──
    no_brokerage = bool(_NO_BROKERAGE_RE.search(description))
    if no_brokerage:
        is_broker = False
    elif _OWNER_RE.search(description):
        is_broker = False
    elif _BROKER_RE.search(description):
        is_broker = True
    else:
        is_broker = False

    # ── Build a useful title if 99acres only gave a generic one ──
    title = name.strip()
    if not title or len(title) < 5:
        parts = [bhk, "for Rent in", canonical_locality]
        title = " ".join(p for p in parts if p)

    return StandardListing(
        source=SOURCE,
        source_id=source_id,
        source_url=url or None,
        title=title,
        body=(description[:5000] if description else None),
        bhk=bhk,
        property_type=property_type,
        furnishing=furnishing,
        rent=rent,
        deposit=deposit,
        maintenance=maintenance,
        locality=canonical_locality,
        address=address or None,
        latitude=lat,
        longitude=lng,
        floor_info=floor_info,
        area_sqft=area_sqft,
        is_broker=is_broker,
        no_brokerage=no_brokerage,
        # 99acres JSON-LD has no date field — use scrape time so ORDER BY posted_at works
        posted_at=datetime.now(timezone.utc),
        raw_payload=item,
    )


# ── Per-locality scrape ───────────────────────────────────────────────────────

def scrape_locality(
    session: requests.Session,
    locality_name: str,
    slug: str,
) -> tuple[list[StandardListing], str]:
    """
    Scrape up to MAX_PAGES pages for one locality.
    Stops early when a page returns no listing objects.
    Deduplicates by source_id within the locality.

    Returns (listings, status) where status is one of:
      "ok"       — at least one listing found
      "empty"    — page fetched successfully but zero JSON-LD listings found
                   (likely a bad slug — 99acres returned a generic/redirect page)
      "blocked"  — first page returned 403 (Cloudflare)
      "error"    — exception during fetch
    """
    listings: list[StandardListing] = []
    seen_ids: set[str] = set()
    url = _build_url(slug, 1)
    logger.info("  %-20s → %s", locality_name, url)

    first_page_status: int | None = None

    for page in range(1, MAX_PAGES + 1):
        raw_items = fetch_page(session, slug, page)

        # Capture HTTP status for first page to detect slug problems
        if page == 1:
            # fetch_page returns [] on 403/error; log the URL so slug is visible
            if not raw_items:
                # Already logged in fetch_page; just surface the URL here
                logger.warning(
                    "  %-20s ZERO listings on page 1 — verify slug: %s",
                    locality_name, url,
                )
                return [], "empty"

        if not raw_items:
            logger.info(
                "  %-20s page %d: 0 items → end of pagination", locality_name, page
            )
            break

        page_new = 0
        skip_no_id = 0
        for item in raw_items:
            try:
                listing = normalize(item, locality_name)
            except Exception as e:
                logger.warning("  normalize() error for %s: %s", locality_name, e)
                continue

            if listing is None:
                skip_no_id += 1
                continue
            if listing.source_id in seen_ids:
                continue

            seen_ids.add(listing.source_id)
            listings.append(listing)
            page_new += 1

        skip_msg = f" ({skip_no_id} skipped: no ID)" if skip_no_id else ""
        logger.info(
            "  %-20s page %d: %d new%s",
            locality_name, page, page_new, skip_msg,
        )

        if page < MAX_PAGES:
            time.sleep(random.uniform(2, 4))

    return listings, ("ok" if listings else "empty")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    started_at = datetime.now(timezone.utc)
    run_id = os.environ.get("GITHUB_RUN_ID")
    db_run_id = record_run_start(SOURCE, run_id)

    # Allow a single-locality test mode: ACRES_TEST_LOCALITY="Koramangala"
    test_locality = os.environ.get("ACRES_TEST_LOCALITY", "").strip()
    if test_locality:
        if test_locality not in LOCALITY_SLUGS:
            logger.error(
                "ACRES_TEST_LOCALITY '%s' not in LOCALITY_SLUGS. Valid: %s",
                test_locality, list(LOCALITY_SLUGS.keys()),
            )
            sys.exit(1)
        target = {test_locality: LOCALITY_SLUGS[test_locality]}
        logger.info("TEST MODE — scraping single locality: %s", test_locality)
    else:
        target = LOCALITY_SLUGS

    logger.info("Starting 99acres ingestion for %d localities", len(target))

    session = _build_session()

    all_listings: list[StandardListing] = []
    locality_counts: dict[str, int] = {}
    locality_status: dict[str, str] = {}   # name → "ok" | "empty" | "error"
    total_errors = 0

    for i, (locality_name, slug) in enumerate(target.items(), 1):
        logger.info("─── [%d/%d] %s ───", i, len(target), locality_name)
        try:
            found, status = scrape_locality(session, locality_name, slug)
            all_listings.extend(found)
            locality_counts[locality_name] = len(found)
            locality_status[locality_name] = status
            logger.info(
                "  %-20s total: %d listings [%s]",
                locality_name, len(found), status.upper(),
            )
        except Exception as e:
            logger.error("  %s: FAILED — %s", locality_name, e)
            locality_counts[locality_name] = 0
            locality_status[locality_name] = "error"
            total_errors += 1

        # Polite inter-locality delay (skip after last one)
        if i < len(target):
            time.sleep(random.uniform(2, 4))

    # ── Per-locality summary table ────────────────────────────────────────────
    logger.info("")
    logger.info("════════════════════════════════════════════════════════")
    logger.info("  LOCALITY SCRAPE SUMMARY")
    logger.info("  %-22s  %6s  %s", "Locality", "Listings", "Status")
    logger.info("  %-22s  %6s  %s", "─" * 22, "─" * 8, "─" * 10)

    problem_localities: list[str] = []
    for name, count in locality_counts.items():
        status = locality_status.get(name, "unknown")
        flag = ""
        if status != "ok":
            flag = "  ← CHECK SLUG"
            problem_localities.append(name)
        logger.info("  %-22s  %6d  %s%s", name, count, status.upper(), flag)

    logger.info("  %-22s  %6s  %s", "─" * 22, "─" * 8, "─" * 10)
    logger.info("  %-22s  %6d", "TOTAL", len(all_listings))
    logger.info("════════════════════════════════════════════════════════")

    if problem_localities:
        logger.warning(
            "  %d locality/ies returned 0 listings — possible bad slug(s): %s\n"
            "  Verify by visiting: https://www.99acres.com/property-for-rent-in-<slug>",
            len(problem_localities), problem_localities,
        )

    logger.info("")

    # ── Upsert + run tracking ─────────────────────────────────────────────────
    stats = UpsertStats()
    if all_listings:
        stats = upsert_listings(all_listings)

    record_run_end(
        db_run_id,
        status="success" if total_errors == 0 else "partial",
        stats=stats,
        total_fetched=len(all_listings),
        locality_counts=locality_counts,
        error_message=(
            None if total_errors == 0
            else f"{total_errors} locality fetches failed"
        ),
        started_at=started_at,
    )
    logger.info(
        "99acres ingestion complete: %d fetched, %d new, %d updated, %d errors",
        len(all_listings), stats.total_new, stats.total_updated, stats.total_errors,
    )

    if stats.total_new + stats.total_updated > 0:
        from transforms.fast_path import run_post_ingest_transforms
        run_post_ingest_transforms(SOURCE, started_at)


if __name__ == "__main__":
    main()
