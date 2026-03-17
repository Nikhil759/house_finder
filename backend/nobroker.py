import base64
import json
import logging
import random
import threading
import time

import requests

from localities import get_nobroker_localities, extract_locality

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Referer": "https://www.nobroker.in/",
}

BASE_URL = "https://www.nobroker.in/api/v3/multi/property/RENT/filter"

NOBROKER_LOCALITIES = get_nobroker_localities()

INGESTION_INTERVAL_SECONDS = 3 * 3600  # 3 hours
NOBROKER_TTL_SECONDS = 4 * 3600        # listings expire after 4 hours

_nobroker_cache: dict = {}     # {locality_name: [listings]}  — kept for live fallback
_cache_updated_at: dict = {}   # {locality_name: timestamp}
_cache_lock = threading.Lock()


# ─────────────────────────────────────────────
# Fetch
# ─────────────────────────────────────────────

def build_search_param(lat, lon, place_name):
    payload = [{"lat": lat, "lon": lon, "placeName": place_name}]
    return base64.b64encode(json.dumps(payload).encode()).decode()


def fetch_nobroker_locality(locality, page=1, limit=30):
    """Fetch listings for one locality from the NoBroker API."""
    search_param = build_search_param(
        locality["lat"], locality["lon"], locality["name"]
    )
    params = {
        "city": "bangalore",
        "isMetro": "false",
        "isScheduleVisitPropertyFilter": "false",
        "locality": locality["name"],
        "pageNo": page,
        "radius": "2.0",
        "searchParam": search_param,
        "sharedAccomodation": "0",
    }
    try:
        resp = requests.get(BASE_URL, params=params, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") == "success":
            return data.get("data", [])
        return []
    except Exception as e:
        logger.error(f"NoBroker fetch failed for {locality['name']}: {e}")
        return []


# ─────────────────────────────────────────────
# Normalise
# ─────────────────────────────────────────────

_FURNISHING_MAP = {
    "FULLY_FURNISHED": "Fully Furnished",
    "SEMI_FURNISHED":  "Semi Furnished",
    "UNFURNISHED":     "Unfurnished",
}


def normalize_nobroker_listing(item, locality_name):
    """Convert a NoBroker API item to our standard listing format."""
    furnishing = _FURNISHING_MAP.get(
        item.get("furnishing", ""), item.get("furnishingDesc", "")
    )

    detail_url = f"https://www.nobroker.in{item.get('detailUrl', '')}"

    created_ts = item.get("activationDate", 0)
    if created_ts:
        created_ts = created_ts / 1000

    last_update_ts = item.get("lastUpdateDate", 0)
    if last_update_ts:
        last_update_ts = last_update_ts / 1000

    amenities_map = item.get("amenitiesMap", {})
    amenity_labels = []
    if amenities_map.get("GYM"):      amenity_labels.append("Gym")
    if amenities_map.get("POOL"):     amenity_labels.append("Pool")
    if amenities_map.get("SECURITY"): amenity_labels.append("Security")
    if amenities_map.get("LIFT"):     amenity_labels.append("Lift")
    if amenities_map.get("PARK"):     amenity_labels.append("Parking")

    raw_locality = (item.get("locality") or locality_name).strip()
    canonical_locality = extract_locality(raw_locality) or raw_locality

    return {
        "id":               f"nb_{item.get('id', '')}",
        "source":           "nobroker",
        "title":            item.get("title", item.get("propertyTitle", "")),
        "body": (
            f"{item.get('typeDesc', '')} | "
            f"{item.get('propertySize', '')} sqft | "
            f"{furnishing} | "
            f"{item.get('address', '')}. "
            f"{item.get('ownerDescription', '')}"
        ),
        "price":            item.get("rent"),
        "price_formatted":  f"₹{item.get('formattedPrice', '')}",
        "deposit":          item.get("deposit"),
        "deposit_formatted": item.get("formattedDeposit", ""),
        "bhk":              item.get("typeDesc", ""),
        "area_sqft":        item.get("propertySize"),
        "locality":         canonical_locality,
        "address":          item.get("address", ""),
        "society":          item.get("society", ""),
        "furnishing":       furnishing,
        "owner_name":       item.get("ownerName", ""),
        "contact":          None,
        "url":              detail_url,
        "thumbnail":        item.get("thumbnailImage", ""),
        "amenities":        amenity_labels,
        "sponsored":        item.get("sponsored", False),
        "lease_type":       item.get("leaseType", "ANYONE"),
        "created":          created_ts,
        "last_updated":     last_update_ts,
        "last_update_string": item.get("lastUpdateString", ""),
        "latitude":         item.get("latitude"),
        "longitude":        item.get("longitude"),
        "property_code":    item.get("propertyCode", ""),
    }


# ─────────────────────────────────────────────
# In-memory cache (kept for live-fetch fallback)
# ─────────────────────────────────────────────

def refresh_locality_cache(locality):
    """Fetch, normalize, cache in-memory, and persist to DB."""
    name = locality["name"]
    logger.info(f"NoBroker: refreshing {name}")
    raw = fetch_nobroker_locality(locality)
    normalized = [normalize_nobroker_listing(item, name) for item in raw]

    with _cache_lock:
        _nobroker_cache[name] = normalized
        _cache_updated_at[name] = time.time()

    # Persist to DB
    try:
        from listing_store import upsert_listings_batch
        upsert_listings_batch(normalized, ttl_seconds=NOBROKER_TTL_SECONDS)
    except Exception as e:
        logger.error(f"NoBroker: DB upsert failed for {name}: {e}")

    logger.info(f"NoBroker: {len(normalized)} listings for {name}")
    return len(normalized)


def start_background_refresh():
    """Start a daemon thread that refreshes all NoBroker localities every 3 hours."""
    def worker():
        while True:
            total = 0
            localities = NOBROKER_LOCALITIES
            for locality in localities:
                try:
                    count = refresh_locality_cache(locality)
                    total += count
                    delay = random.uniform(2, 5)
                    time.sleep(delay)
                except Exception as e:
                    logger.error(f"NoBroker refresh error for {locality['name']}: {e}")

            # Purge old listings once per cycle
            try:
                from listing_store import purge_old_listings
                purge_old_listings(max_age_hours=72)
            except Exception as e:
                logger.error(f"NoBroker: purge failed: {e}")

            logger.info(
                f"NoBroker: full refresh done — {total} listings "
                f"from {len(localities)} localities, sleeping {INGESTION_INTERVAL_SECONDS // 3600}h"
            )
            time.sleep(INGESTION_INTERVAL_SECONDS)

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    logger.info(f"NoBroker ingestion thread started ({len(NOBROKER_LOCALITIES)} localities, every {INGESTION_INTERVAL_SECONDS // 3600}h)")


def get_cached_listings(localities=None):
    """Return in-memory cached listings, optionally filtered by locality list."""
    with _cache_lock:
        all_listings = []
        for name, listings in _nobroker_cache.items():
            if localities is None or name.lower() in [l.lower() for l in localities]:
                all_listings.extend(listings)
        return all_listings
