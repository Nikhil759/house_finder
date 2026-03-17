"""
Housing.com integration — fetches rental listings via GraphQL API.

Hash discovery: on startup, hits Housing.com's autocomplete API to resolve
locality names → internal hashes. Results are cached in-memory so they
survive the process lifetime without repeated lookups.

Background worker refreshes all target localities every 3 hours and
persists listings to the shared `listings` table.
"""

import json
import logging
import random
import threading
import time

import requests

from localities import get_nobroker_localities, extract_locality

logger = logging.getLogger(__name__)

INGESTION_INTERVAL_SECONDS = 3 * 3600   # 3 hours
HOUSING_TTL_SECONDS        = 4 * 3600   # listings expire after 4 hours

# Localities to ingest — reuse the same set as NoBroker
HOUSING_LOCALITIES = get_nobroker_localities()

# Fallback hashes (locality name → Housing.com hash)
# All hashes manually verified via Chrome DevTools on housing.com
_FALLBACK_HASHES: dict = {
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
    "name":      "Bengaluru",
    "id":        "d94a0854185332e78d1b",
    "cityId":    "747be13fe47cb8ae14c3",
    "url":       "bangalore",
    "isTierTwo": False,
    "products":  ["paying_guest", "buy", "plots", "commercial", "flatmate", "rent"],
}

_GQL_URL = "https://mightyzeus-mum.housing.com/api/gql/stale"
_GQL_PARAMS = {
    "apiName":     "SEARCH_RESULTS",
    "emittedFrom": "client_rent_SRP",
    "isBot":       "false",
    "platform":    "desktop",
    "source":      "web",
    "source_name": "AudienceWeb",
}
_GQL_HEADERS = {
    "Content-Type":     "application/json;charset=UTF-8",
    "Origin":           "https://housing.com",
    "Referer":          "https://housing.com/",
    "app-name":         "desktop_web_buyer",
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
      title
      subtitle
      price
      label
      priceUpdateLabel
      address { subAddress address longAddress city { name } }
      furnishingType
      serviceType
      postedDate
      addedOn
      listingId
      url
      carpetArea { value unit }
      streetInfo
      location
      coverImage { url }
    }
  }
}
"""

# In-memory hash cache: {locality_name: hash}
_hash_cache: dict = {}
_hash_lock = threading.Lock()


# ─────────────────────────────────────────────
# Hash discovery
# ─────────────────────────────────────────────

def _fetch_hash(locality_name: str):
    """
    Hit Housing.com's autocomplete API to get the internal locality hash.
    Returns the hash string or None on failure.
    """
    try:
        resp = requests.get(
            "https://housing.com/api/v2/suggest",
            params={
                "q":         locality_name,
                "city_name": "bangalore",
                "service":   "rent",
                "category":  "residential",
            },
            headers={
                "User-Agent":      _GQL_HEADERS["User-Agent"],
                "Accept":          "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.9",
                "Origin":          "https://housing.com",
                "Referer":         "https://housing.com/",
            },
            timeout=8,
        )
        resp.raise_for_status()
        data = resp.json()

        items = data if isinstance(data, list) else data.get("data", data.get("results", []))
        name_lower = locality_name.lower()

        # Prefer exact name match among locality/sublocality types
        for item in items:
            item_type = (item.get("type") or "").lower()
            item_name = (item.get("name") or item.get("displayText") or "").lower()
            if item_type in ("locality", "sublocality") and name_lower in item_name:
                hash_val = item.get("id") or item.get("hash")
                if hash_val:
                    return hash_val

        # Broader fallback: first locality/sublocality hit
        for item in items:
            item_type = (item.get("type") or "").lower()
            if item_type in ("locality", "sublocality"):
                hash_val = item.get("id") or item.get("hash")
                if hash_val:
                    return hash_val

    except Exception as e:
        logger.warning(f"Housing.com hash lookup failed for '{locality_name}': {e}")
    return None


def resolve_hash(locality_name: str):
    """
    Return the Housing.com hash for a locality.
    Checks in-memory cache → autocomplete API → hardcoded fallback.
    """
    with _hash_lock:
        if locality_name in _hash_cache:
            return _hash_cache[locality_name]

    h = _fetch_hash(locality_name)
    if not h:
        h = _FALLBACK_HASHES.get(locality_name)

    if h:
        with _hash_lock:
            _hash_cache[locality_name] = h

    return h


def warm_hash_cache():
    """Pre-resolve hashes for all ingestion localities at startup."""
    def _warm():
        for loc in HOUSING_LOCALITIES:
            name = loc["name"]
            with _hash_lock:
                already = name in _hash_cache
            if not already:
                h = resolve_hash(name)
                logger.info(f"Housing.com hash: {name} → {h or 'NOT FOUND'}")
                time.sleep(random.uniform(0.5, 1.5))

    t = threading.Thread(target=_warm, daemon=True)
    t.start()


# ─────────────────────────────────────────────
# Fetch
# ─────────────────────────────────────────────

def fetch_housing_locality(locality_name: str, page: int = 1, size: int = 30) -> list:
    """
    Fetch listings for one locality from the Housing.com GraphQL API.
    Returns a list of raw property dicts.
    """
    hash_val = resolve_hash(locality_name)
    if not hash_val:
        logger.warning(f"Housing.com: no hash for '{locality_name}', skipping")
        return []

    variables = {
        "hash":          hash_val,
        "service":       "rent",
        "category":      "residential",
        "city":          _CITY_PAYLOAD,
        "pageTypeMajor": "SRP",
        "pageInfo":      {"page": page, "size": size},
    }

    try:
        resp = requests.post(
            _GQL_URL,
            params=_GQL_PARAMS,
            headers=_GQL_HEADERS,
            json={"query": _GQL_QUERY, "variables": json.dumps(variables)},
            timeout=12,
        )
        resp.raise_for_status()
        data = resp.json()
        return (
            data.get("data", {})
                .get("searchResults", {})
                .get("properties", [])
        )
    except Exception as e:
        logger.error(f"Housing.com fetch failed for '{locality_name}': {e}")
        return []


# ─────────────────────────────────────────────
# Normalise
# ─────────────────────────────────────────────

_FURNISHING_MAP = {
    "FULLY_FURNISHED":  "Fully Furnished",
    "SEMI_FURNISHED":   "Semi Furnished",
    "UNFURNISHED":      "Unfurnished",
    "fully furnished":  "Fully Furnished",
    "semi furnished":   "Semi Furnished",
    "unfurnished":      "Unfurnished",
}


def normalize_housing_listing(item: dict, locality_name: str) -> dict:
    """Convert a Housing.com property dict to our standard listing format."""
    listing_id = item.get("listingId", "")
    title      = item.get("title", "")
    price      = item.get("price")
    price_lbl  = item.get("label") or item.get("priceUpdateLabel") or (
        f"₹{price:,}/mo" if isinstance(price, int) else ""
    )

    addr_obj   = item.get("address") or {}
    address    = addr_obj.get("address") or addr_obj.get("longAddress") or addr_obj.get("subAddress") or ""
    city_obj   = addr_obj.get("city") or {}
    raw_loc    = city_obj.get("name") or locality_name
    canonical  = extract_locality(address) or extract_locality(raw_loc) or raw_loc

    furnish_raw = (item.get("furnishingType") or item.get("serviceType") or "").strip()
    furnishing  = _FURNISHING_MAP.get(furnish_raw, furnish_raw)

    carpet_obj  = item.get("carpetArea") or {}
    area_val    = carpet_obj.get("value")
    area_unit   = carpet_obj.get("unit", "sqft")
    area_str    = f"{area_val} {area_unit}" if area_val else ""

    # title often contains BHK info e.g. "3 BHK Flat"
    bhk_match = __import__("re").search(r"(\d)\s*BHK", title, __import__("re").IGNORECASE)
    bhk_str   = f"{bhk_match.group(1)} BHK" if bhk_match else ""

    url_raw    = item.get("url", "")
    detail_url = url_raw if url_raw.startswith("http") else f"https://housing.com{url_raw}"

    cover      = (item.get("coverImage") or {}).get("url") or ""
    posted_str = item.get("postedDate") or item.get("addedOn") or ""
    body       = " | ".join(filter(None, [bhk_str, area_str, furnishing, address]))

    return {
        "id":              f"hc_{listing_id}",
        "source":          "housing",
        "title":           title or f"{bhk_str} for Rent in {raw_loc}",
        "body":            body[:2000],
        "price":           price,
        "price_formatted": price_lbl,
        "bhk":             bhk_str,
        "area_sqft":       area_val,
        "locality":        canonical,
        "address":         address,
        "furnishing":      furnishing,
        "contact":         None,
        "url":             detail_url,
        "thumbnail":       cover,
        "amenities":       [],
        # Housing.com API rarely returns post dates — use ingestion time so
        # listings appear fresh and score correctly on age bonus.
        "created":         time.time(),
        "posted_date":     posted_str,
    }


# ─────────────────────────────────────────────
# Ingestion worker
# ─────────────────────────────────────────────

def refresh_locality(locality: dict) -> int:
    """Fetch, normalize, and persist Housing.com listings for one locality."""
    name = locality["name"]
    raw  = fetch_housing_locality(name)
    if not raw:
        return 0

    normalized = [normalize_housing_listing(item, name) for item in raw]

    try:
        from listing_store import upsert_listings_batch
        upsert_listings_batch(normalized, ttl_seconds=HOUSING_TTL_SECONDS)
    except Exception as e:
        logger.error(f"Housing.com: DB upsert failed for {name}: {e}")

    logger.info(f"Housing.com: {len(normalized)} listings for {name}")
    return len(normalized)


def start_background_refresh():
    """Start a daemon thread that refreshes all Housing.com localities every 3 hours."""
    def worker():
        # Stagger startup so NoBroker and Telegram workers don't all hit at once
        time.sleep(180)
        while True:
            total = 0
            for loc in HOUSING_LOCALITIES:
                try:
                    count = refresh_locality(loc)
                    total += count
                    time.sleep(random.uniform(2, 5))
                except Exception as e:
                    logger.error(f"Housing.com refresh error for {loc['name']}: {e}")

            logger.info(
                f"Housing.com: full refresh done — {total} listings "
                f"from {len(HOUSING_LOCALITIES)} localities, "
                f"sleeping {INGESTION_INTERVAL_SECONDS // 3600}h"
            )
            time.sleep(INGESTION_INTERVAL_SECONDS)

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    logger.info(
        f"Housing.com ingestion thread started "
        f"({len(HOUSING_LOCALITIES)} localities, every {INGESTION_INTERVAL_SECONDS // 3600}h)"
    )
