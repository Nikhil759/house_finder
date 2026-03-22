#!/usr/bin/env python3
"""
Housing.com ingestion script.

Fetches rental listings via the Housing.com GraphQL API for all active
localities, normalizes to StandardListing, and upserts to Supabase Postgres.

Usage:
    python -m ingestion.ingest_housing          # from backend/
    python backend/ingestion/ingest_housing.py  # from repo root
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

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import requests

from ingestion.models import StandardListing
from ingestion.db import (
    upsert_listings, mark_stale, record_run_start, record_run_end, UpsertStats,
)
from ingestion.scoring import compute_quality_score
from localities import extract_locality

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ingest_housing")

# ── Housing.com API config ──

_FALLBACK_HASHES: dict[str, str] = {
    "Whitefield":      "P4ie9y33s0tezykdb",
    "HSR Layout":      "P5kgp2umse63qjm62",
    "Koramangala":     "P5s2sntlyr4a7izpb",
    "Indiranagar":     "Pu0r6m95i80gbhpp",
    "Marathahalli":    "P19pr5xnbnbzon4fz",
    "Bellandur":       "P29di09q225s3j6s1",
    "BTM Layout":      "P3narpkd53st96zbh",
    "Hebbal":          "P5l2wlmnjhlmap6sy",
    "Electronic City": "P16rl894c0qkogx5",
    "Sarjapur Road":   "P1zr02w1owlhq796j",
    "Jayanagar":       "P5vem1jmqfgn3h0vo",
    "JP Nagar":        "P3yqqmgmdvlqoqz0n",
    "Hoodi":           "P4ojovmv8p4us9qur",
    "Yelahanka":       "P5p7bw7u4wfjpda1c",
    "Bannerghatta":    "P2t62bcbf3206th63",
    "Banaswadi":       "P2nfgxlm3u7k6uem6",
    "KR Puram":        "P5ldjyvluv8dq34ho",
    "Bommanahalli":    "P33hbx76231t7ltgp",
    "Banashankari":    "P613h1wbcuq4zmutv",
    "Rajajinagar":     "P1frh56o8juaeivr4",
    "Malleshwaram":    "P53twp7mtetscn6n9",
    "Yeshwanthpur":    "P65u9vd8ee6bzv463",
    "HBR Layout":      "P4gcpc5y1rpweuym0",
}

_CITY_PAYLOAD = {
    "name": "Bengaluru", "id": "d94a0854185332e78d1b",
    "cityId": "747be13fe47cb8ae14c3", "url": "bangalore",
    "isTierTwo": False,
    "products": ["paying_guest", "buy", "plots", "commercial", "flatmate", "rent"],
}

_GQL_URL = "https://mightyzeus-mum.housing.com/api/gql/stale"
_GQL_PARAMS = {
    "apiName": "SEARCH_RESULTS", "emittedFrom": "client_rent_SRP",
    "isBot": "false", "platform": "desktop",
    "source": "web", "source_name": "AudienceWeb",
}
_GQL_HEADERS = {
    "Content-Type": "application/json;charset=UTF-8",
    "Origin": "https://housing.com",
    "Referer": "https://housing.com/",
    "app-name": "desktop_web_buyer",
    "phoenix-api-name": "SEARCH_RESULTS",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
}
_GQL_QUERY = """
query SEARCH_RESULTS($hash: String!, $service: String!, $category: String!,
    $city: CityInput!, $pageTypeMajor: String, $pageInfo: PageInfoInput) {
  searchResults(
    hash: $hash, service: $service, category: $category,
    city: $city, pageTypeMajor: $pageTypeMajor, pageInfo: $pageInfo
  ) {
    properties {
      title subtitle price label priceUpdateLabel
      address { subAddress address longAddress city { name } }
      furnishingType serviceType postedDate addedOn
      listingId url
      carpetArea { value unit }
      streetInfo location
      coverImage { url }
    }
  }
}
"""


def resolve_hash(locality_name: str) -> str | None:
    """
    Resolve a locality name to a Housing.com internal hash.
    Uses hardcoded hashes first (fast, reliable), falls back to
    the autocomplete API only for unknown localities.
    """
    if locality_name in _FALLBACK_HASHES:
        return _FALLBACK_HASHES[locality_name]

    try:
        resp = requests.get(
            "https://housing.com/api/v2/suggest",
            params={"q": locality_name, "city_name": "bangalore", "service": "rent", "category": "residential"},
            headers={"User-Agent": _GQL_HEADERS["User-Agent"], "Accept": "application/json",
                     "Origin": "https://housing.com", "Referer": "https://housing.com/"},
            timeout=8,
        )
        resp.raise_for_status()
        data = resp.json()
        items = data if isinstance(data, list) else data.get("data", data.get("results", []))
        name_lower = locality_name.lower()
        for item in items:
            if (item.get("type") or "").lower() in ("locality", "sublocality"):
                item_name = (item.get("name") or item.get("displayText") or "").lower()
                if name_lower in item_name:
                    return item.get("id") or item.get("hash")
        for item in items:
            if (item.get("type") or "").lower() in ("locality", "sublocality"):
                return item.get("id") or item.get("hash")
    except Exception as e:
        logger.warning("Hash lookup failed for '%s': %s", locality_name, e)
    return None


def fetch_locality(locality_name: str, hash_val: str, page: int = 1, size: int = 30) -> list[dict]:
    """Fetch raw listings for one locality from the Housing.com GraphQL API."""
    variables = {
        "hash": hash_val, "service": "rent", "category": "residential",
        "city": _CITY_PAYLOAD, "pageTypeMajor": "SRP",
        "pageInfo": {"page": page, "size": size},
    }
    try:
        resp = requests.post(
            _GQL_URL, params=_GQL_PARAMS, headers=_GQL_HEADERS,
            json={"query": _GQL_QUERY, "variables": json.dumps(variables)},
            timeout=12,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", {}).get("searchResults", {}).get("properties", [])
    except Exception as e:
        logger.error("Fetch failed for '%s': %s", locality_name, e)
        return []


def normalize(item: dict, locality_name: str) -> StandardListing:
    """Convert a raw Housing.com property dict to StandardListing."""
    listing_id = str(item.get("listingId", ""))
    title = item.get("title", "")
    price = item.get("price")

    addr_obj = item.get("address") or {}
    address = addr_obj.get("address") or addr_obj.get("longAddress") or addr_obj.get("subAddress") or ""
    canonical = extract_locality(address) or extract_locality(locality_name) or locality_name

    carpet_obj = item.get("carpetArea") or {}
    area_val = carpet_obj.get("value")

    url_raw = item.get("url", "")
    detail_url = url_raw if url_raw.startswith("http") else f"https://housing.com{url_raw}"
    cover = (item.get("coverImage") or {}).get("url") or ""
    posted_str = item.get("postedDate") or item.get("addedOn") or ""

    furnish_raw = (item.get("furnishingType") or item.get("serviceType") or "").strip()

    bhk_match = re.search(r"(\d)\s*BHK", title, re.IGNORECASE)
    bhk_str = f"{bhk_match.group(1)} BHK" if bhk_match else None

    body_text = " | ".join(filter(None, [bhk_str, f"{area_val} sqft" if area_val else "", furnish_raw, address]))

    listing = StandardListing(
        source="housing",
        source_id=listing_id,
        source_url=detail_url,
        title=title or f"{bhk_str or 'Flat'} for Rent in {locality_name}",
        body=body_text,
        bhk=bhk_str,
        property_type="Apartment",
        furnishing=furnish_raw,
        rent=price,
        locality=canonical,
        address=address,
        area_sqft=area_val,
        thumbnail_url=cover,
        posted_at=posted_str if posted_str else None,
        raw_payload=item,
    )
    listing.quality_score = compute_quality_score(
        source="housing",
        title=listing.title or "",
        body=listing.body or "",
        rent=listing.rent,
        bhk=listing.bhk,
        furnishing=listing.furnishing,
        posted_at=listing.posted_at,
    )
    return listing


def get_active_localities() -> list[str]:
    """Get active locality names from DB, falling back to localities.py."""
    try:
        from ingestion.db import get_connection
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT name FROM localities WHERE is_active = TRUE")
        names = [r[0] for r in cur.fetchall()]
        conn.close()
        if names:
            return names
    except Exception:
        pass
    from localities import get_nobroker_localities
    return [loc["name"] for loc in get_nobroker_localities()]


def main():
    started_at = datetime.now(timezone.utc)
    run_id = os.environ.get("GITHUB_RUN_ID")
    db_run_id = record_run_start("housing", run_id)

    locality_names = get_active_localities()
    logger.info("Starting Housing.com ingestion for %d localities", len(locality_names))

    # Resolve hashes first
    hashes: dict[str, str] = {}
    for name in locality_names:
        h = resolve_hash(name)
        if h:
            hashes[name] = h
            logger.info("  Hash: %s → %s", name, h)
        else:
            logger.warning("  Hash: %s → NOT FOUND, skipping", name)
        time.sleep(random.uniform(0.5, 1.5))

    all_listings: list[StandardListing] = []
    locality_counts: dict[str, int] = {}
    total_errors = 0

    for name, hash_val in hashes.items():
        try:
            raw_items = fetch_locality(name, hash_val)
            normalized = [normalize(item, name) for item in raw_items]
            all_listings.extend(normalized)
            locality_counts[name] = len(normalized)
            logger.info("  %s: %d listings", name, len(normalized))
            time.sleep(random.uniform(2, 4))
        except Exception as e:
            logger.error("  %s: FAILED — %s", name, e)
            total_errors += 1

    stats = UpsertStats()
    if all_listings:
        stats = upsert_listings(all_listings)

    stale_count = mark_stale("housing", started_at)

    record_run_end(
        db_run_id,
        status="success" if total_errors == 0 else "partial",
        stats=stats,
        total_fetched=len(all_listings),
        total_stale=stale_count,
        locality_counts=locality_counts,
        error_message=None if total_errors == 0 else f"{total_errors} locality fetches failed",
        started_at=started_at,
    )
    logger.info(
        "Housing.com ingestion complete: %d fetched, %d new, %d updated, %d stale",
        len(all_listings), stats.total_new, stats.total_updated, stale_count,
    )


if __name__ == "__main__":
    main()
