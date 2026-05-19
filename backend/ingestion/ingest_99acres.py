#!/usr/bin/env python3
"""
99acres ingestion script.

Scrapes rental listings from 99acres SRP pages by parsing the JSON-LD
structured data embedded in each page's HTML.  No API keys or auth tokens
needed — 99acres server-side-renders listing data inside
<script type="application/ld+json"> tags.

Usage:
    python -m ingestion.ingest_99acres                    # rent only (default)
    python -m ingestion.ingest_99acres --include-pg       # rent + PG
    python -m ingestion.ingest_99acres --include-pg --dry-run  # PG dry-run (no DB writes)

Environment:
    SUPABASE_DB_URL  — Supabase Postgres connection string (required)
    GITHUB_RUN_ID    — set automatically by GitHub Actions (optional)
    ACRES_MAX_PAGES  — override max pages per locality (default 5)
    ACRES_TEST_LOCALITY — scrape only one named locality (for testing)
    ACRES_INCLUDE_PG — set to '1' to include PG listings (alternative to --include-pg)
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
MAX_PAGES = int(os.environ.get("ACRES_MAX_PAGES", "1"))

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


# ── PG locality params (url_slug, city_id, locality_id) ──────────────────────

_PG_LOCALITIES: dict[str, tuple[str, int, int]] = {
    "Whitefield":        ("whitefield", 22, 368),
    "Indiranagar":       ("indiranagar", 22, 354),
    "Marathahalli":      ("marathahalli", 22, 363),
    "Koramangala":       ("koramangala", 22, 356),
    "HSR Layout":        ("hsr-layout", 22, 350),
    "Bellandur":         ("bellandur", 22, 340),
    "BTM Layout":        ("btm-layout", 22, 343),
    "Electronic City":   ("electronic-city", 22, 347),
    "Sarjapur Road":     ("sarjapur-road", 22, 5245),
    "Hebbal":            ("hebbal", 22, 349),
    "HBR Layout":        ("hbr-layout-bangalore", 22, 5260),
    "Bannerghatta Road": ("bannerghatta-road", 22, 339),
    "JP Nagar":          ("jp-nagar", 22, 355),
    "Jayanagar":         ("jayanagar", 22, 353),
    "Yelahanka":         ("yelahanka", 22, 380),
    "Bommanahalli":      ("bommanahalli", 22, 342),
    "Hoodi":             ("hoodi", 22, 5279),
    "Banaswadi":         ("banaswadi", 22, 338),
    "KR Puram":          ("kr-puram", 22, 357),
    "Banashankari":      ("banashankari", 22, 337),
    "Rajajinagar":       ("rajajinagar", 22, 2367),
    "Malleshwaram":      ("malleshwaram", 22, 358),
    "Yeshwanthpur":      ("yeshwanthpur", 22, 7973),
}


def _build_pg_url(slug: str, city_id: int, locality_id: int, page: int) -> str:
    base = (
        f"https://www.99acres.com/search/property/rent/residential/"
        f"{slug}?city={city_id}&locality={locality_id}"
        f"&preference=P&res_com=R&isPreLeased=N"
    )
    return base if page == 1 else f"{base}&page={page}"


_OCCUPANCY_RE = re.compile(
    r"\b(single|double|triple|quad(?:ruple)?)\s*(?:occupancy|sharing|occ\.?)\b", re.I
)
_GENDER_RE = re.compile(
    r"\b((?:for\s+)?(?:male|female|boys?|girls?|men|women|co[\s-]?ed|unisex))\b", re.I
)
_MEALS_RE = re.compile(
    r"\b(?:meals?\s+included|food\s+included|(?:with|incl\.?)\s+(?:meals?|food|tiffin))\b", re.I
)
_ATTACHED_BATH_RE = re.compile(
    r"\b(?:attached\s+(?:bath(?:room)?|washroom)|private\s+(?:bath(?:room)?|washroom))\b", re.I
)
_FOOD_TYPE_RE = re.compile(
    r"\b((?:both\s+)?(?:veg(?:etarian)?|non[\s-]?veg(?:etarian)?))\b", re.I
)
_LOCKIN_RE = re.compile(
    r"(?:lock[\s-]?in\s*(?:period\s*)?(?:of\s*)?|minimum\s+stay\s*(?:of\s*)?)(\d+)\s*month", re.I
)
_DEPOSIT_MONTHS_RE = re.compile(
    r"(\d+)\s*months?\s*(?:(?:security\s+)?deposit|advance)", re.I
)


def _extract_type_attributes(text: str) -> dict:
    """Extract PG-specific attributes from listing description text."""
    attrs: dict = {}

    m = _OCCUPANCY_RE.search(text)
    if m:
        raw = m.group(1).lower()
        if raw.startswith("quad"):
            attrs["occupancy"] = "quad"
        else:
            attrs["occupancy"] = raw

    if re.search(r"\b(?:girls?\s*[&+/]\s*boys?|boys?\s*[&+/]\s*girls?|male\s*[&+/]\s*female|female\s*[&+/]\s*male|co[\s-]?ed|unisex)\b", text, re.I):
        attrs["gender_pref"] = "co-ed"
    else:
        m = _GENDER_RE.search(text)
        if m:
            raw = m.group(1).lower().replace("for ", "")
            if raw in ("male", "boys", "boy", "men"):
                attrs["gender_pref"] = "male"
            elif raw in ("female", "girls", "girl", "women"):
                attrs["gender_pref"] = "female"

    if _MEALS_RE.search(text):
        attrs["meals_included"] = True

    if _ATTACHED_BATH_RE.search(text):
        attrs["attached_bathroom"] = True

    m = _FOOD_TYPE_RE.search(text)
    if m:
        raw = m.group(1).lower()
        if "both" in raw:
            attrs["food_type"] = "both"
        elif "non" in raw:
            attrs["food_type"] = "non-veg"
        else:
            attrs["food_type"] = "veg"

    m = _LOCKIN_RE.search(text)
    if m:
        attrs["lock_in_months"] = int(m.group(1))

    m = _DEPOSIT_MONTHS_RE.search(text)
    if m:
        attrs["deposit_months"] = int(m.group(1))

    return attrs


def normalize_pg(item: dict, locality_name: str) -> StandardListing | None:
    """
    Convert one JSON-LD listing object from a PG SRP page to a StandardListing
    with listing_type='pg' and type_attributes populated.
    """
    url = item.get("url") or ""
    source_id = _extract_source_id(url)
    if not source_id:
        logger.debug("  PG: skipping item with no extractable ID: %.80s", url)
        return None

    name: str = item.get("name") or ""
    description: str = item.get("description") or ""
    combined_text = f"{name} {description}"

    # BHK: only set if explicitly mentioned in text (numberOfRooms for PGs
    # refers to room count, not BHK config)
    bhk = None
    m = re.search(r"(\d)\s*BHK", name, re.IGNORECASE)
    if m:
        bhk = f"{m.group(1)} BHK"

    area_sqft = _parse_floor_size(item.get("floorSize"))

    geo = item.get("geo") or {}
    try:
        lat = float(geo.get("latitude") or 0) or None
    except (ValueError, TypeError):
        lat = None
    try:
        lng = float(geo.get("longitude") or 0) or None
    except (ValueError, TypeError):
        lng = None

    addr_obj = item.get("address") or {}
    address = addr_obj.get("streetAddress") or ""
    canonical_locality = (
        extract_locality(address)
        or extract_locality(locality_name)
        or locality_name
    )

    rent_action_price: int | None = item.get("_rent_action_price")
    # PG pages may embed price in offers.price or offers.lowPrice
    if not rent_action_price:
        offers = item.get("offers") or {}
        for price_key in ("price", "lowPrice", "highPrice"):
            pval = offers.get(price_key)
            if pval:
                rent_action_price = _parse_rent_action_price(str(pval))
                if rent_action_price:
                    break
    rent = rent_action_price or _parse_price(description, _RENT_PATTERNS)
    deposit = _parse_price(description, _DEPOSIT_PATTERNS)
    if deposit and rent and deposit > rent * 12:
        deposit = None

    furnishing = _parse_furnishing(description) or _parse_furnishing(name)
    no_brokerage = bool(_NO_BROKERAGE_RE.search(description))

    title = name.strip()
    if not title or len(title) < 5:
        parts = ["PG for Rent in", canonical_locality]
        title = " ".join(p for p in parts if p)

    type_attributes = _extract_type_attributes(combined_text)

    # Extract occupancy from JSON-LD structured data (QuantitativeValue.maxValue)
    occ_obj = item.get("occupancy")
    if isinstance(occ_obj, dict):
        max_val = occ_obj.get("maxValue")
        if max_val:
            occ_map = {"1": "single", "2": "double", "3": "triple", "4": "quad"}
            if str(max_val) in occ_map:
                type_attributes["occupancy"] = occ_map[str(max_val)]

    return StandardListing(
        source=SOURCE,
        source_id=source_id,
        source_url=url or None,
        title=title,
        body=(description[:5000] if description else None),
        bhk=bhk,
        property_type="pg",
        furnishing=furnishing,
        rent=rent,
        deposit=deposit,
        locality=canonical_locality,
        address=address or None,
        latitude=lat,
        longitude=lng,
        area_sqft=area_sqft,
        is_broker=False,
        no_brokerage=no_brokerage,
        listing_type="pg",
        type_attributes=type_attributes,
        posted_at=datetime.now(timezone.utc),
        raw_payload=item,
    )


def fetch_pg_page(session, base_url: str, page: int) -> list[dict]:
    """
    Fetch one PG SRP page. Same JSON-LD parsing as fetch_page but takes
    a fully-formed base URL (with PG-specific path and params).
    """
    url = base_url if page == 1 else f"{base_url}&page={page}"
    try:
        resp = session.get(url, timeout=25)
    except Exception as e:
        logger.error("  PG request error: %s", e)
        return []

    if resp.status_code == 403:
        logger.warning("  PG 403 — Cloudflare block on %s", url)
        return []
    if not resp.ok:
        logger.error("  PG HTTP %d — URL: %s", resp.status_code, url)
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

        items = data if isinstance(data, list) else [data]
        for obj in items:
            if not isinstance(obj, dict):
                continue
            t = obj.get("@type")
            if t in _LISTING_TYPES or t in ("Hostel", "LodgingBusiness"):
                results.append(obj)
            elif t == "RentAction":
                price_spec = obj.get("priceSpecification") or {}
                price_raw = price_spec.get("price") or price_spec.get("minPrice")
                rent_action_prices.append(
                    _parse_rent_action_price(str(price_raw)) if price_raw else None
                )

    for i, listing in enumerate(results):
        ra_price = rent_action_prices[i] if i < len(rent_action_prices) else None
        listing["_rent_action_price"] = ra_price

    return results


def _enrich_pg_from_detail(session, listing: StandardListing) -> None:
    """
    Fetch the PG detail page and enrich the listing in-place with price
    and additional type_attributes only available on the detail page.
    """
    url = listing.source_url
    if not url:
        return
    try:
        resp = session.get(url, timeout=25)
    except Exception as e:
        logger.debug("  PG detail fetch failed for %s: %s", listing.source_id, e)
        return
    if not resp.ok:
        logger.debug("  PG detail HTTP %d for %s", resp.status_code, listing.source_id)
        return

    html = resp.text

    # Extract price from PriceSpecification JSON-LD
    soup = BeautifulSoup(html, "lxml")
    for tag in soup.find_all("script", type="application/ld+json"):
        raw_text = (tag.string or "").strip()
        if not raw_text:
            continue
        try:
            data = json.loads(raw_text)
        except json.JSONDecodeError:
            continue
        items = data if isinstance(data, list) else [data]
        for obj in items:
            if isinstance(obj, dict) and obj.get("@type") == "PriceSpecification":
                price_val = obj.get("price")
                if price_val:
                    listing.rent = _parse_rent_action_price(str(price_val))

    # Extract structured features from HTML
    attrs = listing.type_attributes

    # Deposit months: "Deposit</div><div>N months rent</div>"
    m = re.search(r"Deposit</div><div[^>]*>(\d+)\s*months?\s*rent", html)
    if m:
        attrs["deposit_months"] = int(m.group(1))

    # Attached bathroom
    if re.search(r"Attached\s+Bathroom", html, re.I):
        attrs["attached_bathroom"] = True

    # Available For: "Girls & Boys", "Girls Only", "Boys Only"
    m = re.search(r'Available\s+For</div><div[^>]*><span[^>]*>([^<]+)', html, re.I)
    if not m:
        m = re.search(r'id="availableForLabel">([^<]+)', html, re.I)
    if m:
        avail = m.group(1).strip().lower()
        if "girls" in avail and "boys" in avail:
            attrs["gender_pref"] = "co-ed"
        elif "girls" in avail or "female" in avail:
            attrs["gender_pref"] = "female"
        elif "boys" in avail or "male" in avail:
            attrs["gender_pref"] = "male"

    # Meals / food from detail page
    if re.search(r"(?:Meals?\s+Included|Food\s+Included|Meals?\s*:\s*(?:Yes|Included))", html, re.I):
        attrs["meals_included"] = True

    # Food type
    m = re.search(r"Food\s+Type[^>]*>.*?<[^>]*>([^<]+)", html, re.I)
    if m:
        ft = m.group(1).strip().lower()
        if "both" in ft or ("veg" in ft and "non" in ft):
            attrs["food_type"] = "both"
        elif "non" in ft:
            attrs["food_type"] = "non-veg"
        elif "veg" in ft:
            attrs["food_type"] = "veg"

    listing.type_attributes = attrs


def scrape_pg_locality(
    session,
    locality_name: str,
    slug: str,
    city_id: int,
    locality_id: int,
) -> tuple[list[StandardListing], str]:
    """Scrape PG listings for one locality. Mirrors scrape_locality."""
    listings: list[StandardListing] = []
    seen_ids: set[str] = set()
    base_url = _build_pg_url(slug, city_id, locality_id, 1)
    logger.info("  PG %-20s → %s", locality_name, base_url)

    for page in range(1, MAX_PAGES + 1):
        raw_items = fetch_pg_page(session, _build_pg_url(slug, city_id, locality_id, page), page)

        if page == 1 and not raw_items:
            logger.warning("  PG %-20s ZERO listings on page 1", locality_name)
            return [], "empty"

        if not raw_items:
            logger.info("  PG %-20s page %d: 0 items → end", locality_name, page)
            break

        page_new = 0
        for item in raw_items:
            try:
                listing = normalize_pg(item, locality_name)
            except Exception as e:
                logger.warning("  PG normalize() error for %s: %s", locality_name, e)
                continue
            if listing is None:
                continue
            if listing.source_id in seen_ids:
                continue
            seen_ids.add(listing.source_id)
            listings.append(listing)
            page_new += 1

        logger.info("  PG %-20s page %d: %d new", locality_name, page, page_new)
        if page < MAX_PAGES:
            time.sleep(random.uniform(2, 4))

    # Enrich each listing from its detail page (for price + extra attributes)
    if listings:
        logger.info("  PG %-20s enriching %d listings from detail pages...", locality_name, len(listings))
        for i, listing in enumerate(listings):
            _enrich_pg_from_detail(session, listing)
            if i < len(listings) - 1:
                time.sleep(random.uniform(0.5, 1.5))
        enriched_with_rent = sum(1 for l in listings if l.rent is not None)
        skipped_no_rent = len(listings) - enriched_with_rent
        logger.info("  PG %-20s enrichment done: %d/%d have rent", locality_name, enriched_with_rent, len(listings))

        if skipped_no_rent:
            for l in listings:
                if l.rent is None:
                    logger.info("  PG %-20s SKIP rent=null: id=%s title=%.60s", locality_name, l.source_id, l.title)
            listings = [l for l in listings if l.rent is not None]
            logger.info("  PG %-20s dropped %d listings with rent=null, %d remain", locality_name, skipped_no_rent, len(listings))

    return listings, ("ok" if listings else "empty")


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

def _print_pg_dry_run_report(pg_listings: list[StandardListing]):
    """Print detailed dry-run report for PG listings."""
    print()
    print("=" * 80)
    print(f"DRY RUN — PG listings that WOULD be upserted: {len(pg_listings)}")
    print("=" * 80)

    if not pg_listings:
        print("  (none)")
        return

    # Coverage stats for type_attributes keys
    attr_keys = ["occupancy", "gender_pref", "meals_included", "attached_bathroom",
                 "food_type", "lock_in_months", "deposit_months"]
    key_counts = {k: 0 for k in attr_keys}
    amenity_counter: dict[str, int] = {}

    for l in pg_listings:
        for k in attr_keys:
            if k in l.type_attributes:
                key_counts[k] += 1
        raw = l.raw_payload or {}
        amenity = raw.get("amenityFeature") or {}
        names = amenity.get("name") or []
        if isinstance(names, str):
            names = [names]
        for name in names:
            amenity_counter[name] = amenity_counter.get(name, 0) + 1

    # Sample of 10
    print()
    print("─── Sample listings (up to 10) ───")
    for i, l in enumerate(pg_listings[:10], 1):
        print(f"\n[{i}] id={l.source_id}  rent=₹{l.rent}  bhk={l.bhk}  locality={l.locality}")
        print(f"    title: {(l.title or '')[:100]}")
        print(f"    body:  {(l.body or '')[:150]}")
        print(f"    listing_type: {l.listing_type}")
        print(f"    type_attributes: {l.type_attributes}")
        print(f"    furnishing: {l.furnishing}  deposit: {l.deposit}  lat/lng: {l.latitude},{l.longitude}")

    # Coverage table
    total = len(pg_listings)
    print()
    print("─── type_attributes coverage ───")
    print(f"{'key':<22} {'count':>6} {'pct':>6}")
    print(f"{'─'*22} {'─'*6} {'─'*6}")
    for k in attr_keys:
        pct = (key_counts[k] / total * 100) if total else 0
        print(f"{k:<22} {key_counts[k]:>6} {pct:>5.1f}%")

    # Amenities from JSON-LD (potential unstandardized PG-specific fields)
    if amenity_counter:
        print()
        print("─── Amenities from JSON-LD (not yet standardized) ───")
        for name, cnt in sorted(amenity_counter.items(), key=lambda x: -x[1]):
            pct = (cnt / total * 100) if total else 0
            print(f"  {name:<40} {cnt:>4} ({pct:>5.1f}%)")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="99acres ingestion script")
    parser.add_argument("--include-pg", action="store_true",
                        help="Include PG listings (off by default)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Fetch and parse but do NOT write to database")
    parser.add_argument("--pg-only", action="store_true",
                        help="Only scrape PG listings (implies --include-pg)")
    args = parser.parse_args()

    include_pg = args.include_pg or args.pg_only or os.environ.get("ACRES_INCLUDE_PG") == "1"
    dry_run = args.dry_run
    pg_only = args.pg_only

    if dry_run:
        logger.info("DRY RUN MODE — zero database writes will be performed")

    _upsert_call_count = 0

    started_at = datetime.now(timezone.utc)
    run_id = os.environ.get("GITHUB_RUN_ID")
    db_run_id = None
    if not dry_run:
        db_run_id = record_run_start(SOURCE, run_id)

    # Allow a single-locality test mode: ACRES_TEST_LOCALITY="Koramangala"
    test_locality = os.environ.get("ACRES_TEST_LOCALITY", "").strip()
    if test_locality:
        if not pg_only and test_locality not in LOCALITY_SLUGS:
            logger.error(
                "ACRES_TEST_LOCALITY '%s' not in LOCALITY_SLUGS. Valid: %s",
                test_locality, list(LOCALITY_SLUGS.keys()),
            )
            sys.exit(1)
        rent_target = {test_locality: LOCALITY_SLUGS[test_locality]} if not pg_only and test_locality in LOCALITY_SLUGS else {}
        pg_target = {test_locality: _PG_LOCALITIES[test_locality]} if include_pg and test_locality in _PG_LOCALITIES else {}
        logger.info("TEST MODE — scraping single locality: %s", test_locality)
    else:
        rent_target = {} if pg_only else LOCALITY_SLUGS
        pg_target = {k: v for k, v in _PG_LOCALITIES.items()} if include_pg else {}

    session = _build_session()

    all_listings: list[StandardListing] = []
    pg_listings: list[StandardListing] = []
    locality_counts: dict[str, int] = {}
    locality_status: dict[str, str] = {}
    total_errors = 0

    # ── Rent scraping (existing behavior) ─────────────────────────────────────
    if rent_target:
        logger.info("Starting 99acres RENT ingestion for %d localities", len(rent_target))
        for i, (locality_name, slug) in enumerate(rent_target.items(), 1):
            logger.info("─── [%d/%d] %s ───", i, len(rent_target), locality_name)
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

            if i < len(rent_target):
                time.sleep(random.uniform(2, 4))

    # ── PG scraping ───────────────────────────────────────────────────────────
    if pg_target:
        logger.info("")
        logger.info("Starting 99acres PG ingestion for %d localities", len(pg_target))
        for i, (locality_name, params) in enumerate(pg_target.items(), 1):
            slug, city_id, locality_id = params
            logger.info("─── PG [%d/%d] %s ───", i, len(pg_target), locality_name)
            try:
                found, status = scrape_pg_locality(session, locality_name, slug, city_id, locality_id)
                pg_listings.extend(found)
                all_listings.extend(found)
                pg_key = f"PG:{locality_name}"
                locality_counts[pg_key] = len(found)
                locality_status[pg_key] = status
                logger.info(
                    "  PG %-20s total: %d listings [%s]",
                    locality_name, len(found), status.upper(),
                )
            except Exception as e:
                logger.error("  PG %s: FAILED — %s", locality_name, e)
                locality_counts[f"PG:{locality_name}"] = 0
                locality_status[f"PG:{locality_name}"] = "error"
                total_errors += 1

            if i < len(pg_target):
                time.sleep(random.uniform(2, 4))

    # ── Summary table ─────────────────────────────────────────────────────────
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
            "  %d locality/ies returned 0 listings — possible bad slug(s): %s",
            len(problem_localities), problem_localities,
        )

    logger.info("")

    # ── Dry-run report ────────────────────────────────────────────────────────
    if dry_run:
        if pg_listings:
            _print_pg_dry_run_report(pg_listings)
        print(f"\nZero database writes performed during dry-run. "
              f"Verified by: upsert_listings() call site was guarded by "
              f"'if not dry_run' and never reached.")
        return

    # ── Upsert + run tracking ─────────────────────────────────────────────────
    stats = UpsertStats()
    if all_listings:
        stats = upsert_listings(all_listings)
        _upsert_call_count += 1

    if db_run_id is not None:
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

    from sync.trigger import trigger_sync_after_completion
    trigger_sync_after_completion(reason="ingest_99acres")


if __name__ == "__main__":
    main()
