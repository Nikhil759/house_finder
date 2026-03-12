import base64
import json
import logging
import threading
import time

import requests

logger = logging.getLogger(__name__)

NOBROKER_LOCALITIES = [
    {"name": "Whitefield",     "lat": 12.9698,  "lon": 77.7499,  "placeId": "ChIJg_wNXfMRrjsR-RUB2BKlzzA"},
    {"name": "HSR Layout",     "lat": 12.9116,  "lon": 77.6389,  "placeId": "ChIJFdMEbNQUrjsRKxbFsNELMFU"},
    {"name": "Koramangala",    "lat": 12.9279,  "lon": 77.6271,  "placeId": "ChIJlx7OQXoWrjsRfDZTyYYJFGI"},
    {"name": "Indiranagar",    "lat": 12.9784,  "lon": 77.6408,  "placeId": "ChIJJzaa72YWrjsRxj7HHaTiAnI"},
    {"name": "Marathahalli",   "lat": 12.9591,  "lon": 77.7010,  "placeId": "ChIJFQHYCugTrjsRkpFeMJnhioQ"},
    {"name": "Bellandur",      "lat": 12.9237,  "lon": 77.6766,  "placeId": "ChIJy3gRZdIUrjsRhxk_jAL0Zq8"},
    {"name": "BTM Layout",     "lat": 12.9166,  "lon": 77.6101,  "placeId": "ChIJZ5LnVXIWrjsRxk17ItDfT04"},
    {"name": "Hebbal",         "lat": 13.0354,  "lon": 77.5970,  "placeId": "ChIJE47r0bMTrjsRqFrJhQvvz3A"},
    {"name": "Electronic City","lat": 12.8399,  "lon": 77.6770,  "placeId": "ChIJCxUQnPkUrjsRXSVTBFHbSPE"},
    {"name": "Sarjapur Road",  "lat": 12.9087,  "lon": 77.6950,  "placeId": "ChIJt7R_qS8UrjsRF4ULF9l7VaQ"},
    {"name": "Hoodi",          "lat": 12.9888,  "lon": 77.7113,  "placeId": "ChIJCyddpJARrjsRKnXrc3LZVNk"},
    {"name": "Yelahanka",      "lat": 13.1005,  "lon": 77.5963,  "placeId": "ChIJzWmM2nQTrjsR0vYmrPCQMwA"},
]

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

CACHE_TTL_SECONDS = 1800  # 30 minutes

_nobroker_cache: dict = {}     # {locality_name: [listings]}
_cache_updated_at: dict = {}   # {locality_name: timestamp}
_cache_lock = threading.Lock()


# ─────────────────────────────────────────────
# Fetch
# ─────────────────────────────────────────────

def build_search_param(lat, lon, place_id, place_name):
    payload = [{"lat": lat, "lon": lon, "placeId": place_id, "placeName": place_name}]
    return base64.b64encode(json.dumps(payload).encode()).decode()


def fetch_nobroker_locality(locality, page=1, limit=30):
    """Fetch listings for one locality from the NoBroker API."""
    search_param = build_search_param(
        locality["lat"], locality["lon"], locality["placeId"], locality["name"]
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
        "locality":         item.get("locality", locality_name).strip(),
        "address":          item.get("address", ""),
        "society":          item.get("society", ""),
        "furnishing":       furnishing,
        "owner_name":       item.get("ownerName", ""),
        "contact":          None,  # hidden behind NoBroker paywall
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
# Cache + background refresh
# ─────────────────────────────────────────────

def refresh_locality_cache(locality):
    """Fetch and cache listings for one locality."""
    name = locality["name"]
    logger.info(f"NoBroker: refreshing cache for {name}")
    raw = fetch_nobroker_locality(locality)
    normalized = [normalize_nobroker_listing(item, name) for item in raw]
    with _cache_lock:
        _nobroker_cache[name] = normalized
        _cache_updated_at[name] = time.time()
    logger.info(f"NoBroker: cached {len(normalized)} listings for {name}")


def start_background_refresh():
    """Start a daemon thread that refreshes all localities every 30 minutes."""
    def worker():
        while True:
            for locality in NOBROKER_LOCALITIES:
                try:
                    refresh_locality_cache(locality)
                    time.sleep(2)  # small delay between localities
                except Exception as e:
                    logger.error(f"NoBroker background refresh error: {e}")
            logger.info("NoBroker: full refresh complete, sleeping 30 min")
            time.sleep(CACHE_TTL_SECONDS)

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    logger.info("NoBroker background refresh thread started")


def get_cached_listings(localities=None):
    """Return cached listings, optionally filtered by locality list."""
    with _cache_lock:
        all_listings = []
        for name, listings in _nobroker_cache.items():
            if localities is None or name.lower() in [l.lower() for l in localities]:
                all_listings.extend(listings)
        return all_listings
