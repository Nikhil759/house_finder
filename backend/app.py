from flask import Flask, jsonify, request
from flask_cors import CORS
import requests as http
import re
import time
import sqlite3
import json
import os
import asyncio
import logging
import random
import threading
from decimal import Decimal
from dotenv import load_dotenv
from nobroker import (
    start_background_refresh,
    get_cached_listings,
    NOBROKER_LOCALITIES,
    _cache_updated_at,
    _nobroker_cache,
    _cache_lock,
)
from housing import (
    start_background_refresh as start_housing_refresh,
    warm_hash_cache,
)
from localities import (
    normalize_locality,
    suggest_locality,
    extract_locality,
    expand_locality,
    get_all_locality_names_lower,
    get_locality_api_data,
    LOCALITY_COORDS,
    ALL_LOCALITY_NAMES,
)
from listing_store import (
    init_listings_table,
    upsert_listings_batch,
    query_listings,
    get_listing_by_id,
    get_listing_counts,
    get_locality_counts,
    purge_old_listings,
    total_listing_count,
)
from flag_store import (
    ALLOWED_CATEGORIES,
    NOTE_MAX_CHARS,
    check_rate_limits,
    get_existing_flag,
    get_flag_summaries,
    get_flag_summary,
    list_flags_for_listing,
    retract_flag as retract_flag_record,
    submit_flag,
)
from view_store import (
    get_view_summaries,
    get_view_summary,
    is_valid_uuid as is_valid_view_uuid,
    log_view,
)

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Start background ingestion workers
start_background_refresh()   # NoBroker: every 3 hours

_UA = "python:bangalore-housing-finder:v1.0 (by /u/nikhil7599)"
HEADERS = {"User-Agent": _UA}

REDDIT_USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
]


def get_reddit_headers():
    return {
        "User-Agent":      random.choice(REDDIT_USER_AGENTS),
        "Accept":          "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer":         "https://www.reddit.com/",
        "Origin":          "https://www.reddit.com",
        "DNT":             "1",
        "Connection":      "keep-alive",
        "Sec-Fetch-Dest":  "empty",
        "Sec-Fetch-Mode":  "cors",
        "Sec-Fetch-Site":  "same-origin",
    }

# ─────────────────────────────────────────────
# Bangalore subreddits — fixed
# ─────────────────────────────────────────────
SUBREDDITS   = ["bangalore", "bengaluru", "indianrealestate", "bangalorerentals", "FlatandFlatmatesBLR", "FlatmatesinBangalore"]
_SUBREDDIT_STR = "+".join(SUBREDDITS)
# OAuth endpoint — used when credentials are present; avoids cloud-IP 403s
SEARCH_URL_OAUTH  = f"https://oauth.reddit.com/r/{_SUBREDDIT_STR}/search"
# Public fallback — works fine on local/residential IPs
SEARCH_URL_PUBLIC = f"https://www.reddit.com/r/{_SUBREDDIT_STR}/search.json"

# PullPush.io — Reddit mirror, no auth required, works from cloud IPs
PULLPUSH_URL = "https://api.pullpush.io/reddit/search/submission/"

# ─────────────────────────────────────────────
# Reddit OAuth token cache
# ─────────────────────────────────────────────
_reddit_token: dict = {"access_token": None, "expires_at": 0}


def _get_reddit_token():
    """
    Fetch (or return cached) a Reddit app-only OAuth token.
    Requires REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET env vars.
    Returns the token string, or None if credentials are not configured.
    """
    client_id     = os.getenv("REDDIT_CLIENT_ID", "")
    client_secret = os.getenv("REDDIT_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        return None

    # Return cached token if still valid (with 60 s buffer)
    if _reddit_token["access_token"] and time.time() < _reddit_token["expires_at"] - 60:
        return _reddit_token["access_token"]

    try:
        resp = http.post(
            "https://www.reddit.com/api/v1/access_token",
            auth=(client_id, client_secret),
            data={"grant_type": "client_credentials"},
            headers={"User-Agent": _UA},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        _reddit_token["access_token"] = data["access_token"]
        _reddit_token["expires_at"]   = time.time() + data.get("expires_in", 3600)
        return _reddit_token["access_token"]
    except Exception as e:
        print(f"Reddit OAuth token fetch failed: {e}")
        return None

# ─────────────────────────────────────────────
# Session-based Reddit fetching with anti-403 measures
# ─────────────────────────────────────────────
_reddit_cache: dict = {}
REDDIT_CACHE_TTL = 600  # 10 minutes


def fetch_reddit_listings(query, subreddits, limit=50):
    """Hit the public Reddit search JSON endpoint using a browser-like session."""
    session = http.Session()

    # Warm up with a homepage hit so Reddit sets its session cookies
    try:
        session.get("https://www.reddit.com/", headers=get_reddit_headers(), timeout=10)
        time.sleep(random.uniform(0.5, 1.5))
    except Exception:
        pass  # proceed even if warm-up fails

    url = f"https://www.reddit.com/r/{'+'.join(subreddits)}/search.json"
    params = {
        "q":           query,
        "sort":        "new",
        "limit":       limit,
        "t":           "month",
        "restrict_sr": "on",
    }

    try:
        resp = session.get(url, params=params, headers=get_reddit_headers(), timeout=15)
        resp.raise_for_status()
        return resp.json()
    except http.exceptions.HTTPError as e:
        if resp.status_code == 403:
            logger.warning("Reddit 403 blocked. Returning empty.")
            return {"data": {"children": []}}
        raise


def fetch_reddit_with_retry(query, subreddits, limit=50, retries=2):
    """Retry fetch_reddit_listings with back-off when Reddit returns empty or 403."""
    for attempt in range(retries):
        result   = fetch_reddit_listings(query, subreddits, limit)
        children = result.get("data", {}).get("children", [])
        if children or attempt == retries - 1:
            return result
        wait = (attempt + 1) * random.uniform(2, 4)
        logger.info(f"Reddit empty/blocked, retrying in {wait:.1f}s")
        time.sleep(wait)
    return {"data": {"children": []}}


def get_reddit_cached(query, subreddits, limit=50):
    """Return cached Reddit results (10-minute TTL) or fetch fresh ones."""
    cache_key = f"{query}_{','.join(sorted(subreddits))}"
    cached    = _reddit_cache.get(cache_key)
    if cached:
        ts, results = cached
        if time.time() - ts < REDDIT_CACHE_TTL:
            logger.info("Reddit: serving from cache")
            return results

    results = fetch_reddit_with_retry(query, subreddits, limit)
    _reddit_cache[cache_key] = (time.time(), results)
    return results


BANGALORE_AREAS = list(get_all_locality_names_lower())

# ─────────────────────────────────────────────
# Telegram groups
# ─────────────────────────────────────────────
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


def is_relevant(text, bhk, keywords):
    if not text:
        return False
    text_lower = text.lower()
    if not any(kw in text_lower for kw in RENT_KEYWORDS):
        return False
    if bhk and bhk != "any" and bhk.lower() not in text_lower:
        return False
    if keywords:
        for kw in keywords.lower().split():
            if kw not in text_lower:
                return False
    return True


def extract_price(text):
    patterns = [
        r"₹\s?[\d,]+",
        r"rs\.?\s?[\d,]+",
        r"[\d,]+\s?(?:per month|/month|pm|k/month)",
    ]
    for pat in patterns:
        match = re.search(pat, text, re.IGNORECASE)
        if match:
            return match.group(0).strip()
    return None


def extract_contact(text):
    match = re.search(r"(?:\+91[\s-]?)?[6-9]\d{9}", text)
    return match.group(0) if match else None


# ─────────────────────────────────────────────
# Telegram structured parser
# ─────────────────────────────────────────────

# Patterns whose first line should be discarded as a generic header
_GENERIC_TG_TITLE = re.compile(
    r"^\W*\d\s*(?:bhk?|bedroom)\s*(?:listing|available|flat|apartment|for\s*rent|rental)?\W*$"
    r"|^\W*(?:flat|room|apartment|property)\s*(?:for\s*rent|available|listing)?\W*$"
    r"|^\W*(?:rent|rental|listing|post|announcement)\W*$"
    r"|^\W*(?:🏠|🏡|🏢|🔑)+\W*$",
    re.IGNORECASE,
)

_HEADER_FIELD_RE = re.compile(
    r"^(location|rent|deposit|contact|call|note|nearby|amenities|bhk|type|available)[:\s]",
    re.IGNORECASE,
)


def extract_telegram_title(text, parsed):
    """
    Return the most informative title line from a Telegram post.
    Falls back to constructing one from parsed fields, then the raw first line.
    """
    lines = [l.strip() for l in text.split("\n") if l.strip()]

    for line in lines:
        # Strip markdown bold/header markers and common emojis used as decoration
        clean = re.sub(r"\*+|={3,}|#+|[🏠🏡🏢🔑✅📍💰🛋️]", "", line).strip()
        if len(clean) < 20:
            continue
        if _GENERIC_TG_TITLE.match(clean):
            continue
        if _HEADER_FIELD_RE.match(clean):
            continue
        return clean[:120]

    # Nothing informative in the text — build a synthetic title from parsed fields
    parts = []
    if parsed.get("bhk"):
        parts.append(parsed["bhk"])
    if parsed.get("furnishing"):
        parts.append(parsed["furnishing"])
    if parsed.get("location_text"):
        parts.append(parsed["location_text"])
    if parsed.get("rent"):
        parts.append(f"₹{parsed['rent']:,}/mo")
    if parts:
        return " · ".join(parts)

    # Absolute last resort
    return lines[0][:120] if lines else ""


def parse_telegram_post(text):
    """
    Extract structured fields from a Telegram rental post body.
    Returns a dict with all optional keys (absent if not found).
    """
    result = {}
    if not text:
        return result

    # Rent
    for pattern in [
        r'rent[:\s*]+[₹rs\.]*\s*([\d,]+)',
        r'[₹rs\.]+\s*([\d,]+)\s*/?\s*month',
        r'[₹rs\.]+\s*([\d,]+)\s*(?:per month|pm|p\.m)',
    ]:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            try:
                result["rent"] = int(m.group(1).replace(",", ""))
                break
            except ValueError:
                pass

    # Deposit
    for pattern in [
        r'(?:total\s+)?deposit[:\s*]+[₹rs\.]*\s*([\d,]+(?:\.\d+)?(?:\s*lacs?)?)',
        r'(?:security\s+)?deposit[:\s*]+[₹rs\.]*\s*([\d,]+)',
        r'advance[:\s*]+[₹rs\.]*\s*([\d,]+)',
    ]:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            result["deposit_text"] = m.group(1).strip()
            break

    # BHK
    m = re.search(r'(\d)\s*(?:BHK|bhk|bedroom|bed room)', text, re.IGNORECASE)
    if m:
        result["bhk"] = f"{m.group(1)} BHK"
    elif re.search(r'studio|1\s*rk', text, re.IGNORECASE):
        result["bhk"] = "Studio/1RK"

    # Furnishing
    if re.search(r'fully[\s-]furnished', text, re.IGNORECASE):
        result["furnishing"] = "Fully Furnished"
    elif re.search(r'semi[\s-]furnished', text, re.IGNORECASE):
        result["furnishing"] = "Semi Furnished"
    elif re.search(r'unfurnished|un-furnished', text, re.IGNORECASE):
        result["furnishing"] = "Unfurnished"

    # Location line
    m = re.search(r'\*{0,2}location[:\*\s]+\*{0,2}(.+?)(?:\n|$)', text, re.IGNORECASE)
    if m:
        result["location_text"] = m.group(1).strip().rstrip("*")

    # Google Maps link
    m = re.search(
        r'(https?://(?:maps\.app\.goo\.gl|goo\.gl/maps|maps\.google\.com)\S+)', text
    )
    if m:
        result["maps_url"] = m.group(1)

    # Contact number (prefer labelled one over bare number)
    m = re.search(
        r'(?:contact|call|whatsapp|reach|phone|mob(?:ile)?)?[:\s]*'
        r'(\+?91[\s-]?)?([6-9]\d{9})',
        text, re.IGNORECASE,
    )
    if m:
        result["contact"] = m.group(2)

    # No-brokerage flag
    result["no_brokerage"] = bool(
        re.search(r'no[\s-]brok(?:er|erage)', text, re.IGNORECASE)
    )

    # Amenities
    amenity_patterns = {
        "Gym":          r'\bgym\b',
        "Pool":         r'\bpool\b|\bswimming\b',
        "Security":     r'\bsecurity\b|\b24/7\b',
        "Parking":      r'\bparking\b',
        "Wifi":         r'\bwifi\b|\bwi-fi\b|\binternet\b',
        "Power Backup": r'\bpower[\s-]backup\b',
        "Lift":         r'\blift\b|\belevator\b',
        "Gated":        r'\bgated\b',
    }
    amenities = [label for label, pat in amenity_patterns.items()
                 if re.search(pat, text, re.IGNORECASE)]
    if amenities:
        result["amenities"] = amenities

    # Flatmate / shared flag
    result["is_flatmate"] = bool(
        re.search(
            r'flatmate|flat.?mate|roommate|room.?mate|room available|'
            r'single room|one room|1 room|sharing',
            text, re.IGNORECASE,
        )
    )

    # Subtitle — first meaningful non-header line
    for line in [l.strip() for l in text.split("\n") if l.strip()]:
        clean = re.sub(r'\*+|={3,}', '', line).strip()
        if len(clean) > 20 and not clean.lower().startswith(
            ('location', 'rent', 'deposit', 'contact', 'note', 'nearb')
        ):
            result["subtitle"] = clean
            break

    return result


async def fetch_telegram_async(bhk, keywords, limit=25):
    api_id         = os.getenv("TELEGRAM_API_ID")
    api_hash       = os.getenv("TELEGRAM_API_HASH")
    session_string = os.getenv("TELEGRAM_SESSION_STRING")   # preferred (production)
    session_name   = os.getenv("TELEGRAM_SESSION_NAME", "housing_finder")  # local fallback

    if not api_id or not api_hash:
        print("Telegram credentials not set")
        return []

    from telethon import TelegramClient
    from telethon.sessions import StringSession
    from telethon.errors import ChannelPrivateError, UsernameNotOccupiedError, FloodWaitError

    # Use StringSession when available (Railway/production — no disk needed),
    # otherwise fall back to the local .session file (local dev).
    if session_string:
        session = StringSession(session_string)
    else:
        session = os.path.join(os.path.dirname(__file__), session_name)

    client = TelegramClient(session, int(api_id), api_hash)
    try:
        await client.connect()
        if not await client.is_user_authorized():
            print("Telegram session not found — run the one-time auth script first")
            return []

        posts = []
        for group in BANGALORE_TELEGRAM_GROUPS:
            try:
                # Fetch more than needed so we can score and pick the best
                messages = await client.get_messages(group, limit=50)
                group_posts = []
                for msg in messages:
                    text = msg.text or ""
                    if not is_relevant(text, bhk, keywords):
                        continue
                    parsed = parse_telegram_post(text)
                    title  = extract_telegram_title(text, parsed)

                    raw_price = extract_price(text)
                    rent_int  = parsed.get("rent")
                    price_formatted = (
                        f"₹{rent_int:,}" if rent_int
                        else raw_price
                    )

                    tg_locality = (
                        normalize_locality(parsed.get("location_text", ""))
                        or extract_locality(text)
                    )

                    post = {
                        "id":      str(msg.id),
                        "source":  "telegram",
                        "title":   title,
                        "body":    text[:800],
                        "author":  str(msg.sender_id or ""),
                        "url":     f"https://t.me/{group}/{msg.id}",
                        "group":   f"t.me/{group}",
                        "score":   0,
                        "comments": 0,
                        "created": int(msg.date.timestamp()),
                        "flair":   "",
                        # price: prefer parsed int, fall back to regex string
                        "price":           rent_int or raw_price,
                        "price_formatted": price_formatted,
                        "contact":         parsed.get("contact") or extract_contact(text),
                        # structured fields from parser
                        "bhk":          parsed.get("bhk"),
                        "furnishing":   parsed.get("furnishing"),
                        "locality":     tg_locality,
                        "deposit_text": parsed.get("deposit_text"),
                        "maps_url":     parsed.get("maps_url"),
                        "amenities":    parsed.get("amenities", []),
                        "no_brokerage": parsed.get("no_brokerage", False),
                        "is_flatmate":  parsed.get("is_flatmate", False),
                        "subtitle":     parsed.get("subtitle"),
                    }
                    group_posts.append(post)
                # Cap at 15 best per group to prevent one noisy group dominating
                posts.extend(group_posts[:15])
            except (ChannelPrivateError, UsernameNotOccupiedError):
                print(f"Cannot access {group}, skipping")
                continue
            except FloodWaitError as e:
                print(f"Flood wait {e.seconds}s, stopping")
                break
            except Exception as e:
                print(f"Error for {group}: {e}")
                continue
        return posts
    finally:
        await client.disconnect()


def fetch_telegram(bhk, keywords, limit=25):
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(
            fetch_telegram_async(bhk, keywords, limit)
        )
    except Exception as e:
        print(f"Telegram fetch failed: {e}")
        return []


# ─────────────────────────────────────────────
# Telegram ingestion worker
# ─────────────────────────────────────────────
TELEGRAM_INGESTION_INTERVAL = 3 * 3600  # 3 hours
TELEGRAM_TTL_SECONDS = 4 * 3600         # listings expire after 4 hours


def _run_telegram_ingestion():
    """Fetch all Telegram listings (no filters) and persist to DB."""
    try:
        posts = fetch_telegram(bhk="any", keywords="", limit=50)
        if posts:
            upsert_listings_batch(posts, ttl_seconds=TELEGRAM_TTL_SECONDS)
            logger.info(f"Telegram ingestion: stored {len(posts)} listings")
        else:
            logger.info("Telegram ingestion: no posts fetched")
        return len(posts)
    except Exception as e:
        logger.error(f"Telegram ingestion failed: {e}")
        return 0


def start_telegram_ingestion():
    """Start a daemon thread that ingests Telegram listings every 3 hours."""
    def worker():
        time.sleep(60)  # wait 1 min after startup before first run
        while True:
            try:
                count = _run_telegram_ingestion()
                logger.info(
                    f"Telegram ingestion done — {count} listings, "
                    f"sleeping {TELEGRAM_INGESTION_INTERVAL // 3600}h"
                )
            except Exception as e:
                logger.error(f"Telegram ingestion worker error: {e}")
            time.sleep(TELEGRAM_INGESTION_INTERVAL)

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    logger.info("Telegram ingestion thread started (every 3h)")


# ─────────────────────────────────────────────
# Quality scoring
# ─────────────────────────────────────────────
_SCORE_LOCALITIES = list(get_all_locality_names_lower())
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


def score_post(post):
    score = 0
    # Combine text fields from both Reddit (selftext) and Telegram (body)
    text = " ".join([
        post.get("title", ""),
        post.get("body", ""),
        post.get("selftext", ""),
    ]).lower()

    if post.get("price"):
        score += 20
    if post.get("contact"):
        score += 20
    if any(loc in text for loc in _SCORE_LOCALITIES):
        score += 15
    if any(b in text for b in ["1bhk", "2bhk", "3bhk", "1 bhk", "2 bhk", "3 bhk", "studio", "1rk"]):
        score += 15
    if any(f in text for f in ["furnished", "semi-furnished", "unfurnished"]):
        score += 5
    if any(d in text for d in ["deposit", "advance", "security"]):
        score += 5

    age = time.time() - post.get("created", 0)
    if age < 86400:
        score += 20
    elif age < 604800:
        score += 10
    elif age < 2592000:
        score += 5

    if post.get("source") == "reddit":
        if post.get("score", 0) > 10:
            score += 10
        elif post.get("score", 0) > 3:
            score += 5
        if post.get("comments", 0) > 5:
            score += 5

    if post.get("source") == "telegram":
        body_len = len(post.get("body", ""))
        if body_len > 200:
            score += 10
        elif body_len > 100:
            score += 5
        elif body_len < 30:
            score -= 10
        # Telegram posts explicitly marked no-brokerage get same trust boost
        if post.get("no_brokerage"):
            score += 15

    # NoBroker listings — trust bonus, skip broker penalty
    if post.get("source") == "nobroker":
        return max(0, min(100, score + 15))

    # Housing.com — trust bonus + furnishing bonus for variation
    if post.get("source") == "housing":
        furnishing = (post.get("furnishing") or "").lower()
        if "fully" in furnishing:
            score += 5
        elif "semi" in furnishing:
            score += 2
        return max(0, min(100, score + 15))

    # 99acres — structured source, skip broker penalty (descriptions may mention broker/agent)
    if post.get("source") == "99acres":
        return max(0, min(100, score + 15))

    if post.get("source") in ("zolo", "colive"):
        s = 30
        age = time.time() - post.get("created", 0)
        if age < 86400: s += 15
        elif age < 604800: s += 10
        elif age < 2592000: s += 5
        if post.get("price") or post.get("rent"):
            s += 10
        if post.get("latitude") and post.get("longitude"):
            s += 10
        if post.get("image_count") or post.get("thumbnail_url"):
            s += 10
        ta = post.get("type_attributes") or {}
        if ta.get("gender_pref"):
            s += 5
        if ta.get("occupancy"):
            s += 5
        if ta.get("attached_bathroom") is not None:
            s += 5
        return max(0, min(100, s))

    broker_hits = sum(1 for s in _BROKER_SIGNALS if s in text)
    if broker_hits >= 2:
        score -= 20
    elif broker_hits == 1:
        score -= 10

    if any(s in text for s in _SPAM_SIGNALS):
        score -= 15

    return max(0, min(100, score))


# ─────────────────────────────────────────────
# SQLite alerts DB
# ─────────────────────────────────────────────
_DATABASE_URL = os.environ.get("DATABASE_URL", "")
_SQLITE_PATH  = os.path.join(os.path.dirname(__file__), "alerts.db")


def _use_postgres():
    return bool(_DATABASE_URL)


class _Cursor:
    """Normalises sqlite3 cursor and psycopg2 cursor to a common interface."""

    def __init__(self, cur, pg=False):
        self._cur     = cur
        self._pg      = pg
        self._last_id = None

    @property
    def lastrowid(self):
        return self._last_id if self._pg else self._cur.lastrowid

    def fetchall(self):
        rows = self._cur.fetchall()
        if self._pg and self._cur.description:
            cols = [d[0] for d in self._cur.description]
            return [dict(zip(cols, row)) for row in rows]
        return rows


class _Conn:
    """
    Thin connection wrapper.

    * sqlite3  — used when DATABASE_URL is not set (local dev)
    * psycopg2 — used when DATABASE_URL is set (Railway / production)

    Implements the context-manager protocol so all existing
    `with get_db() as conn:` call-sites continue to work unchanged.
    """

    def __init__(self):
        if _use_postgres():
            import psycopg2
            url = _DATABASE_URL
            # Railway sometimes gives "postgres://" but psycopg2 prefers "postgresql://"
            if url.startswith("postgres://"):
                url = "postgresql://" + url[len("postgres://"):]
            self._conn = psycopg2.connect(url, connect_timeout=10)
            self._pg   = True
        else:
            self._conn            = sqlite3.connect(_SQLITE_PATH)
            self._conn.row_factory = sqlite3.Row
            self._pg              = False

    def execute(self, sql, params=()):
        cur = self._conn.cursor()
        if self._pg:
            sql = sql.replace("?", "%s")
            # Append RETURNING id so lastrowid works for INSERT statements
            if sql.strip().upper().startswith("INSERT"):
                sql += " RETURNING id"
        cur.execute(sql, params)
        wrapped = _Cursor(cur, self._pg)
        if self._pg and sql.strip().upper().startswith("INSERT"):
            row = cur.fetchone()
            wrapped._last_id = row[0] if row else None
        return wrapped

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, *_):
        if exc_type is None:
            self._conn.commit()
        else:
            self._conn.rollback()
        self._conn.close()
        return False


def get_db():
    return _Conn()


def init_db():
    create_sqlite = """
        CREATE TABLE IF NOT EXISTS alerts (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            email          TEXT    NOT NULL,
            bhk            TEXT    DEFAULT 'any',
            area           TEXT    DEFAULT '',
            budget         TEXT    DEFAULT '',
            keywords       TEXT    DEFAULT '',
            label          TEXT    DEFAULT '',
            last_sent_ids  TEXT    DEFAULT '[]',
            created_at     TEXT    DEFAULT CURRENT_TIMESTAMP
        )
    """
    create_pg = """
        CREATE TABLE IF NOT EXISTS alerts (
            id             SERIAL  PRIMARY KEY,
            email          TEXT    NOT NULL,
            bhk            TEXT    DEFAULT 'any',
            area           TEXT    DEFAULT '',
            budget         TEXT    DEFAULT '',
            keywords       TEXT    DEFAULT '',
            label          TEXT    DEFAULT '',
            last_sent_ids  TEXT    DEFAULT '[]',
            created_at     TEXT    DEFAULT CURRENT_TIMESTAMP
        )
    """
    with get_db() as conn:
        conn.execute(create_pg if _use_postgres() else create_sqlite)


init_db()
init_listings_table()
start_telegram_ingestion()  # Telegram: every 3 hours
start_housing_refresh()     # Housing.com: every 3 hours (staggered 3 min after startup)
warm_hash_cache()           # Pre-resolve Housing.com locality hashes in background


# ─────────────────────────────────────────────
# Search helpers
# ─────────────────────────────────────────────
def build_query(area: str, bhk: str, budget: str, keywords: str) -> str:
    housing_terms = (
        "(rent OR rental OR PG OR flatmate OR \"for rent\" OR \"to let\" "
        "OR \"room available\" OR \"flat available\" OR \"available from\" OR \"looking for tenant\")"
    )
    parts = ["Bangalore", housing_terms]
    if area:
        parts.append(area)
    if bhk and bhk != "any":
        parts.append(bhk)
    if budget:
        parts.append(budget)
    if keywords:
        parts.append(keywords)
    return " ".join(parts)


LISTING_KEYWORDS = [
    "rent", "rental", "pg", "flatmate", "flat", "bhk", "room",
    "available", "tenant", "lease", "hostel", "studio", "deposit",
    "furnished", "unfurnished", "sharing", "accommodation", "1rk",
]


def is_listing(post: dict) -> bool:
    text = (post["title"] + " " + post["selftext"]).lower()
    return any(kw in text for kw in LISTING_KEYWORDS)


def quality_score(post: dict) -> int:
    text  = (post["title"] + " " + post["selftext"]).lower()
    score = 0

    price_pat = re.compile(
        r"(?:₹|rs\.?\s*)\d[\d,]*"
        r"|\d+(?:\.\d+)?k\s*/?\s*(?:month|mo|pm\b)"
        r"|\d[\d,]+\s*/?\s*(?:per\s*month|month|pm\b)",
        re.IGNORECASE,
    )
    if price_pat.search(text):          score += 20
    if re.search(r"(?<!\d)[6-9]\d{9}(?!\d)", text): score += 20
    if any(a in text for a in BANGALORE_AREAS):       score += 15
    if re.search(r"\b[1-4]\s*[-–]?\s*bhk\b|\b[1-4]\s*bedroom|\bstudio\b|\b1rk\b", text, re.IGNORECASE):
        score += 15
    if post.get("score", 0) > 5: score += 10

    age = time.time() - post.get("created", 0)
    if age < 86400:         score += 20
    elif age < 7 * 86400:  score += 10

    return score


def _normalise_reddit_post(p: dict) -> dict:
    """Normalise a raw Reddit post dict (works for both API and PullPush responses)."""
    text = p.get("title", "") + " " + p.get("selftext", "")
    permalink = p.get("permalink", "")
    url = (
        permalink if permalink.startswith("http")
        else f"https://reddit.com{permalink}"
    )
    post = {
        "id":        p.get("id"),
        "source":    "reddit",
        "title":     p.get("title", ""),
        "subreddit": p.get("subreddit", ""),
        "author":    p.get("author", "[deleted]"),
        "url":       url,
        "selftext":  p.get("selftext", "")[:500],
        "score":     p.get("score", 0),
        "comments":  p.get("num_comments", 0),
        "created":   p.get("created_utc", 0),
        "flair":     p.get("link_flair_text") or "",
        "price":     extract_price(text),
        "contact":   extract_contact(text),
        "locality":  extract_locality(text),
    }
    post["quality_score"] = quality_score(post)
    return post


def _build_pullpush_query(area: str, bhk: str, keywords: str) -> str:
    """
    PullPush rejects long boolean queries — build a short keyword string instead.
    """
    parts = ["bangalore", "rent"]
    if area:
        parts.append(area)
    if bhk and bhk != "any":
        # e.g. "2BHK" → "2bhk"
        parts.append(bhk.lower().replace(" ", ""))
    if keywords:
        parts.extend(keywords.split()[:3])   # max 3 extra keywords
    return " ".join(parts)


def _fetch_via_pullpush(area: str, bhk: str, keywords: str, limit: int):
    """
    Fetch Reddit posts via PullPush.io — no auth required, works from cloud IPs.
    Uses a simplified query (PullPush rejects long OR-chains).
    Returns (raw_posts_list, error_string_or_None).
    """
    params = {
        "q":         _build_pullpush_query(area, bhk, keywords),
        "subreddit": ",".join(SUBREDDITS),
        "size":      min(limit, 100),
        "sort":      "desc",
        "sort_type": "created_utc",
        "after":     int(time.time()) - 30 * 86400,  # last 30 days
    }
    try:
        resp = http.get(PULLPUSH_URL, headers=HEADERS, params=params, timeout=15)
        resp.raise_for_status()
        return resp.json().get("data", []), None
    except Exception as e:
        return [], str(e)


def fetch_listings(area="", bhk="any", budget="", keywords="", limit=30):
    """
    Fetch Reddit listings with a two-tier approach:
      1. Reddit OAuth API  — when REDDIT_CLIENT_ID / SECRET are set (most reliable)
      2. PullPush.io       — no-auth Reddit mirror, works from cloud IPs
         Uses a simplified keyword query (PullPush rejects long OR-chains).
    Falls back gracefully to empty results on total failure so the rest of the
    app (Telegram, NoBroker) keeps working.
    """
    query = build_query(area, bhk, budget, keywords)  # kept for display/alerts

    # ── Tier 1: Reddit OAuth ──────────────────────────────────────────────────
    token = _get_reddit_token()
    if token:
        params  = {"q": query, "sort": "new", "limit": limit, "t": "month", "restrict_sr": "1"}
        headers = {**HEADERS, "Authorization": f"bearer {token}"}
        try:
            resp = http.get(SEARCH_URL_OAUTH, headers=headers, params=params, timeout=10)
            resp.raise_for_status()
            raw   = [item["data"] for item in resp.json().get("data", {}).get("children", [])]
            posts = [_normalise_reddit_post(p) for p in raw]
            posts = [p for p in posts if is_listing(p)]
            return posts, query, None
        except Exception as e:
            logger.warning(f"Reddit OAuth fetch failed, trying session-based: {e}")

    # ── Tier 2: Session-based public .json (UA rotation, cookies, cache) ────────
    try:
        data  = get_reddit_cached(query, SUBREDDITS, limit)
        raw   = [item["data"] for item in data.get("data", {}).get("children", [])]
        posts = [_normalise_reddit_post(p) for p in raw]
        posts = [p for p in posts if is_listing(p)]
        if posts:
            return posts, query, None
    except Exception as e:
        logger.warning(f"Session-based Reddit fetch failed, trying PullPush: {e}")

    # ── Tier 3: PullPush.io ───────────────────────────────────────────────────
    raw, err = _fetch_via_pullpush(area, bhk, keywords, limit)
    if err is None:
        posts = [_normalise_reddit_post(p) for p in raw]
        posts = [p for p in posts if is_listing(p)]
        return posts, query, None

    # All sources failed — return empty gracefully so Telegram/NoBroker still work
    logger.error(f"All Reddit sources failed: {err}")
    return [], query, None


# ─────────────────────────────────────────────
# Alert label helper
# ─────────────────────────────────────────────
def generate_label(area, bhk, budget, keywords):
    parts = []
    if bhk and bhk != "any":
        parts.append(re.sub(r"(\d)(BHK)", r"\1 \2", bhk, flags=re.IGNORECASE))
    if area:     parts.append(area.strip())
    if budget:   parts.append(f"under {budget.strip()}")
    if keywords: parts.append(keywords.strip())
    return " · ".join(parts) if parts else "All Bangalore listings"


# ─────────────────────────────────────────────
# Email helpers
# ─────────────────────────────────────────────
def _extract_price(text):
    m = re.search(r"(?:₹|rs\.?\s*)(\d[\d,]+)", text, re.IGNORECASE)
    if m:
        return f"₹{m.group(1)}/mo"
    m = re.search(r"(\d+(?:\.\d+)?)\s*k\s*/?\s*(?:month|mo|pm\b)", text, re.IGNORECASE)
    if m:
        return f"₹{int(float(m.group(1)) * 1000):,}/mo"
    return None


def _extract_bhk(text):
    m = re.search(r"\b([1-4])\s*[-–]?\s*bhk\b", text, re.IGNORECASE)
    if m:
        return f"{m.group(1)} BHK"
    if re.search(r"\bstudio\b", text, re.IGNORECASE):
        return "Studio"
    return None


def build_email_html(label: str, posts: list) -> str:
    rows = ""
    for p in posts[:10]:
        text  = p["title"] + " " + p.get("selftext", "")
        price = _extract_price(text)
        bhk   = _extract_bhk(text)
        title = p["title"][:100] + ("…" if len(p["title"]) > 100 else "")

        pills = ""
        if bhk:
            pills += (f'<span style="background:#1a2a3a;color:#7eb8f7;padding:2px 8px;'
                      f'border-radius:20px;font-size:11px;margin-right:5px;">🏠 {bhk}</span>')
        if price:
            pills += (f'<span style="background:#1a2e1a;color:#6ee09a;padding:2px 8px;'
                      f'border-radius:20px;font-size:11px;margin-right:5px;">💰 {price}</span>')

        rows += f"""
        <tr>
          <td style="padding:14px 16px;border-bottom:1px solid #1e1e2e;">
            <a href="{p['url']}" style="color:#f5a623;text-decoration:none;font-size:13px;
               font-family:Georgia,serif;line-height:1.4;display:block;margin-bottom:7px;">{title}</a>
            <div style="margin-bottom:7px;">{pills}</div>
            <div style="font-size:10px;color:#444;font-family:monospace;">
              r/{p['subreddit']} · u/{p['author']}
            </div>
          </td>
        </tr>"""

    count = len(posts)
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d14;color:#e8e4d8;">
  <div style="max-width:580px;margin:0 auto;padding:32px 20px;font-family:monospace;">
    <p style="color:#f5a623;font-size:10px;letter-spacing:0.2em;margin:0 0 8px 0;">
      REDDIT HOUSING SCANNER · BANGALORE
    </p>
    <h1 style="color:#e8e4d8;font-family:Georgia,serif;font-weight:normal;font-size:22px;margin:0 0 8px 0;">
      {count} new listing{"s" if count != 1 else ""} found
    </h1>
    <p style="color:#555;font-size:12px;margin:0 0 28px 0;">
      Alert: <span style="color:#888;font-style:italic;">{label}</span>
    </p>

    <table width="100%" cellpadding="0" cellspacing="0"
      style="border-collapse:collapse;background:#0d0d1e;border:1px solid #1e1e2e;border-radius:8px;overflow:hidden;">
      {rows}
    </table>

    <p style="color:#2a2a3a;font-size:10px;margin-top:28px;text-align:center;line-height:1.8;">
      You're receiving this because you set up a housing alert on NestIQ.<br>
      To stop, delete the saved search from the app.
    </p>
  </div>
</body></html>"""


def send_alert_email(to_email: str, label: str, new_posts: list):
    api_key   = os.environ.get("RESEND_API_KEY", "")
    from_addr = os.environ.get("RESEND_FROM_EMAIL", "onboarding@resend.dev")

    if not api_key:
        return False, "RESEND_API_KEY not configured"

    count = len(new_posts)
    try:
        resp = http.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "from":    from_addr,
                "to":      [to_email],
                "subject": f"🏠 {count} new listing{'s' if count != 1 else ''}: {label}",
                "html":    build_email_html(label, new_posts),
            },
            timeout=10,
        )
        return resp.status_code in (200, 201), resp.text
    except Exception as e:
        return False, str(e)


# ─────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────

@app.route("/api/health")
def health():
    telegram_ready = bool(os.getenv("TELEGRAM_API_ID") and os.getenv("TELEGRAM_API_HASH"))
    return jsonify({"status": "ok", "telegram": telegram_ready})


@app.route("/api/gemini-health")
def gemini_health():
    import time, requests as _req
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        return jsonify({"status": "no_key", "model": None, "latency_ms": None})

    candidates = [
        ("v1beta", "gemini-2.0-flash-lite"),
        ("v1beta", "gemini-flash-lite-latest"),
        ("v1beta", "gemini-2.0-flash"),
        ("v1beta", "gemini-flash-latest"),
        ("v1beta", "gemini-2.5-flash"),
    ]
    payload = {
        "contents": [{"parts": [{"text": "Reply with: ok"}]}],
        "generationConfig": {"maxOutputTokens": 5},
    }
    last_error = None
    for api_version, model in candidates:
        url = f"https://generativelanguage.googleapis.com/{api_version}/models/{model}:generateContent"
        try:
            t0 = time.time()
            resp = _req.post(url, params={"key": api_key}, json=payload, timeout=10)
            latency_ms = int((time.time() - t0) * 1000)
            if resp.status_code == 200:
                return jsonify({"status": "ok", "model": model, "latency_ms": latency_ms})
            err_body = resp.json() if resp.content else {}
            last_error = err_body.get("error", {}).get("message") or f"HTTP {resp.status_code}"
        except Exception as e:
            last_error = str(e)
    return jsonify({"status": "unavailable", "model": None, "latency_ms": None, "error": last_error})


@app.route("/api/search")
def search():
    area       = request.args.get("area", "").strip()
    bhk        = request.args.get("bhk", "any").strip()
    budget     = request.args.get("budget", "").strip()
    min_budget = request.args.get("min_budget", "").strip()
    keywords   = request.args.get("keywords", "").strip()
    limit      = min(int(request.args.get("limit", 50)), 50)
    sort       = request.args.get("sort", "score")
    min_score  = max(0, min(60, int(request.args.get("min_score", 20))))
    sources_param = request.args.get("sources", "reddit,telegram,nobroker")
    source_list   = [s.strip() for s in sources_param.split(",") if s.strip()]
    listing_type  = request.args.get("listing_type", "").strip() or None

    # Resolve locality expansion upfront
    canonical_area = normalize_locality(area) if area else None
    target_localities = expand_locality(area) if canonical_area else []
    target_set = {loc.lower() for loc in target_localities}

    all_posts      = []
    query          = None
    reddit_warning = False
    from_db        = False

    db_localities = target_localities if canonical_area else None

    # ── Single DB query for ALL sources at once (1 connection, not N) ──
    db_posts = query_listings(
        localities=db_localities,
        sources=source_list,
        bhk=bhk,
        budget=budget,
        min_budget=min_budget or None,
        limit=limit * 2,
        listing_type=listing_type,
    )

    if db_posts:
        all_posts += db_posts
        from_db = True

    # Check which sources came back from DB; live-fetch any missing ones.
    # Skip live-fetch when a specific listing_type is requested — live sources
    # don't carry listing_type metadata and would pollute filtered results.
    found_sources = {p.get("source") for p in db_posts} if db_posts else set()
    missing_sources = [s for s in source_list if s not in found_sources] if not listing_type else []

    for src in missing_sources:
        if src == "reddit":
            try:
                reddit_posts, query, _ = fetch_listings(area, bhk, budget, keywords, limit)
                all_posts += reddit_posts
                logger.info(f"Reddit live fetch returned {len(reddit_posts)} posts")
            except Exception as e:
                logger.error(f"Reddit fetch failed: {e}")
                reddit_warning = True

        elif src == "telegram":
            tg_posts = fetch_telegram(bhk, keywords, limit)
            all_posts += tg_posts
            logger.info(f"Telegram live fetch returned {len(tg_posts)} posts")

        elif src == "nobroker":
            nb_listings = get_cached_listings()
            if bhk and bhk != "any":
                bhk_norm = bhk.lower().replace(" ", "")
                nb_listings = [
                    p for p in nb_listings
                    if bhk_norm in p.get("bhk", "").lower().replace(" ", "")
                ]
            if budget:
                try:
                    budget_val = int(budget)
                    nb_listings = [p for p in nb_listings if (p.get("price") or 0) <= budget_val]
                except ValueError:
                    pass
            all_posts += nb_listings

    query = query or (build_query(area, bhk, budget, keywords) if area else "")

    # ── Locality filter ──
    if canonical_area and target_set:
        all_posts = [
            p for p in all_posts
            if (p.get("locality") or "").lower() in target_set
        ]
    elif area:
        # Unrecognised locality — return no results so the "Did you mean?" banner is the only output
        all_posts = []

    # ── listing_type filter for live-fetched posts (DB already filtered) ──
    if listing_type and all_posts:
        all_posts = [
            p for p in all_posts
            if p.get("listing_type", "full_house") == listing_type
        ]

    # ── Keyword filter (applied regardless of DB or live) ──
    if keywords and all_posts:
        kw_lower = keywords.lower().split()
        all_posts = [
            p for p in all_posts
            if all(
                kw in (
                    (p.get("title") or "") + " " +
                    (p.get("selftext") or "") + " " +
                    (p.get("body") or "")
                ).lower()
                for kw in kw_lower
            )
        ]

    # Use curated quality_score when available; fall back to legacy scorer
    for post in all_posts:
        if not post.get("detail_score"):
            post["quality_score"] = score_post(post)

    # Filter out low-quality posts
    all_posts = [p for p in all_posts if p["quality_score"] >= min_score]

    # Sort
    if sort == "newest":
        all_posts.sort(key=lambda x: x.get("created", x.get("created_utc", 0)), reverse=True)
    elif sort == "upvotes":
        all_posts.sort(key=lambda x: x.get("score", 0), reverse=True)
    elif sort == "score":
        # "Top Rated" — pure quality rank, no interleaving
        all_posts.sort(key=lambda x: x["quality_score"], reverse=True)
    else:
        # "Balanced" (default) — quality sort within each source, then round-robin
        # interleave by source so no single source dominates visually.
        all_posts.sort(key=lambda x: x["quality_score"], reverse=True)
        from collections import defaultdict
        _buckets = defaultdict(list)
        for _post in all_posts:
            _buckets[_post["source"]].append(_post)
        _source_order = ["nobroker", "housing", "99acres", "reddit", "telegram"]
        _interleaved = []
        while any(_buckets[s] for s in _source_order):
            for _src in _source_order:
                if _buckets[_src]:
                    _interleaved.append(_buckets[_src].pop(0))
        all_posts = _interleaved

    locality_warning    = bool(area and not canonical_area)
    locality_suggestion = suggest_locality(area) if locality_warning else None

    # ── Embed flag + view summaries (each one batch query, never N+1) ─────────
    _attach_flag_summaries(all_posts)
    _attach_view_summaries(all_posts)

    return jsonify({
        "posts":               all_posts,
        "total":               len(all_posts),
        "query":               query or "",
        "subreddits":          SUBREDDITS,
        "reddit_warning":      reddit_warning,
        "locality_expanded":   target_localities if canonical_area else [],
        "locality_warning":    locality_warning,
        "locality_suggestion": locality_suggestion,
        "from_db":             from_db,
    })


@app.route("/api/listing/<path:listing_id>")
def get_listing(listing_id):
    """Return a single listing by composite ID (source_sourceid)."""
    listing = get_listing_by_id(listing_id)
    if not listing:
        return jsonify({"error": "Listing not found"}), 404
    listing["quality_score"] = score_post(listing)
    canonical_id = listing.get("id") or listing_id
    summary = get_flag_summary(canonical_id)
    listing["flag_count"]        = summary.get("count", 0)
    listing["flag_top_category"] = summary.get("top_category")
    listing["view_count"]        = get_view_summary(canonical_id)
    return jsonify(listing)


# ─────────────────────────────────────────────
# Listing flags (renter reports)
#
# Flags are a SOFT signal — visibility/ranking is NEVER affected. These
# endpoints back the FlagModal + Renter Reports UI.
# ─────────────────────────────────────────────

def _attach_flag_summaries(posts: list) -> None:
    """
    Populate `flag_count` and `flag_top_category` on each post in-place using a
    SINGLE batch query. This is the contract that prevents N+1 fetching from
    the listing card.
    """
    if not posts:
        return
    listing_ids = [p["id"] for p in posts if p.get("id")]
    summaries = get_flag_summaries(listing_ids)
    for post in posts:
        s = summaries.get(post.get("id"))
        post["flag_count"]        = s["count"] if s else 0
        post["flag_top_category"] = s["top_category"] if s else None


def _attach_view_summaries(posts: list) -> None:
    """
    Populate `view_count` on each post in-place using a SINGLE batch query
    against the `listing_view_stats` precomputed cache. Same N+1-avoidance
    contract as _attach_flag_summaries.
    """
    if not posts:
        return
    listing_ids = [p["id"] for p in posts if p.get("id")]
    summaries = get_view_summaries(listing_ids)
    for post in posts:
        post["view_count"] = summaries.get(post.get("id"), 0)


def _client_ip():
    """Best-effort client IP extraction (honours X-Forwarded-For for Railway/Vercel)."""
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        # Left-most entry is the original client.
        return forwarded.split(",")[0].strip() or None
    return request.remote_addr or None


@app.route("/api/flags", methods=["POST"])
def create_flag():
    """
    Submit a flag for a listing. Anonymous-friendly — no auth required.

    Body: { listing_id, category, device_id, note?, user_id? }
    """
    body = request.get_json(silent=True) or {}
    listing_id = (body.get("listing_id") or "").strip()
    category   = (body.get("category") or "").strip()
    device_id  = (body.get("device_id") or "").strip()
    note       = body.get("note")
    user_id    = body.get("user_id")
    if user_id:
        user_id = str(user_id).strip() or None

    if not listing_id:
        return jsonify({"error": "listing_id required"}), 400
    if category not in ALLOWED_CATEGORIES:
        return jsonify({
            "error": "Invalid category",
            "allowed": list(ALLOWED_CATEGORIES),
        }), 400

    if note and len(note) > NOTE_MAX_CHARS:
        note = note[:NOTE_MAX_CHARS]

    ip_address = _client_ip()

    # Anti-abuse — device + IP fallback rate limits.
    allowed, limit_err = check_rate_limits(device_id, ip_address)
    if not allowed:
        return jsonify({"error": "rate_limited", "code": limit_err}), 429

    flag, err = submit_flag(
        listing_id=listing_id,
        category=category,
        device_id=device_id,
        note=note,
        user_id=user_id,
        ip_address=ip_address,
    )
    if err == "duplicate":
        existing = get_existing_flag(listing_id, device_id)
        return jsonify({
            "error":    "duplicate",
            "message":  "You've already flagged this listing.",
            "existing": existing,
        }), 409
    if err == "invalid_device":
        return jsonify({"error": "invalid_device"}), 400
    if err == "invalid_category":
        return jsonify({"error": "invalid_category"}), 400
    if err or not flag:
        return jsonify({"error": err or "unknown"}), 500

    summary = get_flag_summary(listing_id)
    return jsonify({"flag": flag, "summary": summary}), 201


@app.route("/api/flags/<flag_id>", methods=["DELETE"])
def remove_flag(flag_id):
    """
    Retract a flag. Caller must supply the originating device_id either as a
    header (X-Device-Id) or as ?device_id= so we can verify ownership.
    """
    device_id = (
        request.headers.get("X-Device-Id", "").strip()
        or request.args.get("device_id", "").strip()
    )
    if not device_id:
        return jsonify({"error": "device_id required"}), 400

    ok, err = retract_flag_record(flag_id, device_id)
    if err == "not_found":
        return jsonify({"error": "not_found"}), 404
    if err == "forbidden":
        return jsonify({"error": "forbidden"}), 403
    if not ok:
        return jsonify({"error": err or "unknown"}), 500

    return jsonify({"success": True})


@app.route("/api/flags/<path:listing_id>", methods=["GET"])
def list_flags(listing_id):
    """Return active flags for a listing (anonymous — no author info exposed)."""
    flags = list_flags_for_listing(listing_id, limit=100)
    summary = get_flag_summary(listing_id)
    by_category = {}
    for f in flags:
        by_category[f["category"]] = by_category.get(f["category"], 0) + 1
    return jsonify({
        "listing_id":  listing_id,
        "count":       summary.get("count", 0),
        "top_category": summary.get("top_category"),
        "by_category": by_category,
        "flags":       flags,
    })


# ─────────────────────────────────────────────
# Listing views (renter view tracking)
#
# A view = a load of the listing detail page. Server-side dedupe per
# (listing_id, device_id) within a 24h window keeps refresh inflation out
# of the count. Views are an INFORMATIONAL signal — they never affect
# ranking, scoring, or visibility.
# ─────────────────────────────────────────────
@app.route("/api/listing-views", methods=["POST"])
def log_listing_view():
    """
    Record a listing-detail-page view.

    Body: { listing_id, device_id, user_id? }

    Response: { ok: bool, deduped: bool }
      * ok=true,  deduped=false → a new view was counted
      * ok=true,  deduped=true  → within the 24h window; not re-counted
      * ok=false                → invalid payload or DB error
    """
    body = request.get_json(silent=True) or {}
    listing_id = (body.get("listing_id") or "").strip()
    device_id  = (body.get("device_id")  or "").strip()
    user_id    = body.get("user_id")
    if user_id:
        user_id = str(user_id).strip() or None

    if not listing_id:
        return jsonify({"error": "listing_id required"}), 400
    if not is_valid_view_uuid(device_id):
        return jsonify({"error": "invalid_device"}), 400

    ok, deduped = log_view(
        listing_id,
        device_id,
        user_id=user_id,
        ip_address=_client_ip(),
    )
    if not ok:
        return jsonify({"ok": False, "deduped": False, "error": "log_failed"}), 500

    return jsonify({"ok": True, "deduped": deduped})


@app.route("/api/search/new")
def search_new():
    """Return listings newer than 'since' (ISO8601) matching saved-search params."""
    from datetime import datetime

    location      = request.args.get("location", "").strip()
    bhk           = request.args.get("bhk", "any").strip()
    budget        = request.args.get("budget", "").strip()
    keywords      = request.args.get("keywords", "").strip()
    sources_param = request.args.get("sources", "telegram,nobroker,housing").strip()
    since         = request.args.get("since", "").strip()
    limit         = min(int(request.args.get("limit", 20)), 50)

    if not since:
        return jsonify({"listings": [], "count": 0})

    try:
        # Normalise Supabase ISO8601 (ends with +00:00 or Z)
        since_norm = since.replace("Z", "+00:00")
        dt = datetime.fromisoformat(since_norm)
        since_utc = dt.timestamp()
    except Exception as exc:
        logger.warning("search/new: invalid since param %r — %s", since, exc)
        return jsonify({"listings": [], "count": 0, "error": "Invalid since param"})

    source_list = [s.strip() for s in sources_param.split(",") if s.strip()]

    canonical_area    = normalize_locality(location) if location else None
    target_localities = expand_locality(location) if canonical_area else []
    target_set        = {loc.lower() for loc in target_localities}
    db_localities     = target_localities if canonical_area else None

    # Single DB query for all sources at once
    all_posts = query_listings(
        localities=db_localities,
        sources=source_list,
        bhk=bhk,
        budget=budget,
        limit=limit,
        since_utc=since_utc,
    )

    # Locality filter
    if canonical_area and target_set:
        all_posts = [p for p in all_posts if (p.get("locality") or "").lower() in target_set]
    elif location:
        all_posts = []

    # Keyword filter
    if keywords and all_posts:
        kw_lower = keywords.lower().split()
        all_posts = [
            p for p in all_posts
            if all(
                kw in (
                    (p.get("title") or "") + " " +
                    (p.get("selftext") or "") + " " +
                    (p.get("body") or "")
                ).lower()
                for kw in kw_lower
            )
        ]

    for post in all_posts:
        if not post.get("detail_score"):
            post["quality_score"] = score_post(post)

    all_posts = [p for p in all_posts if p["quality_score"] >= 20]
    all_posts.sort(key=lambda x: x["quality_score"], reverse=True)

    _attach_flag_summaries(all_posts)
    _attach_view_summaries(all_posts)

    return jsonify({"listings": all_posts, "count": len(all_posts)})


@app.route("/api/alerts", methods=["POST"])
def create_alert():
    body = request.get_json(silent=True) or {}
    email = body.get("email", "").strip()
    if not email or "@" not in email:
        return jsonify({"error": "Valid email required"}), 400

    bhk      = body.get("bhk", "any") or "any"
    area     = body.get("area", "") or ""
    budget   = body.get("budget", "") or ""
    keywords = body.get("keywords", "") or ""
    label    = body.get("label") or generate_label(area, bhk, budget, keywords)

    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO alerts (email, bhk, area, budget, keywords, label) VALUES (?,?,?,?,?,?)",
            (email, bhk, area, budget, keywords, label),
        )
        conn.commit()
        alert_id = cur.lastrowid

    return jsonify({"id": alert_id, "email": email, "label": label}), 201


@app.route("/api/alerts/<int:alert_id>", methods=["DELETE"])
def delete_alert(alert_id):
    with get_db() as conn:
        conn.execute("DELETE FROM alerts WHERE id = ?", (alert_id,))
        conn.commit()
    return jsonify({"success": True})


@app.route("/api/alerts/check")
def check_alerts():
    with get_db() as conn:
        alerts = [dict(r) for r in conn.execute("SELECT * FROM alerts").fetchall()]

    sent_count = 0
    results    = []

    for alert in alerts:
        posts, _, err = fetch_listings(
            area=alert["area"], bhk=alert["bhk"],
            budget=alert["budget"], keywords=alert["keywords"],
            limit=30,
        )
        if err:
            results.append({"id": alert["id"], "error": err})
            continue

        last_sent = set(json.loads(alert.get("last_sent_ids") or "[]"))
        new_posts = [p for p in posts if p["id"] not in last_sent]

        if new_posts:
            ok, detail = send_alert_email(alert["email"], alert["label"], new_posts)
            if ok:
                sent_count += 1
                all_ids = json.dumps([p["id"] for p in posts])
                with get_db() as conn:
                    conn.execute("UPDATE alerts SET last_sent_ids=? WHERE id=?",
                                 (all_ids, alert["id"]))
                    conn.commit()
            results.append({"id": alert["id"], "new": len(new_posts), "sent": ok, "detail": detail})
        else:
            results.append({"id": alert["id"], "new": 0, "sent": False})

    return jsonify({"emails_sent": sent_count, "results": results})


@app.route("/api/nobroker/status")
def nobroker_status():
    with _cache_lock:
        status = {
            locality["name"]: {
                "count":        len(_nobroker_cache.get(locality["name"], [])),
                "last_updated": _cache_updated_at.get(locality["name"]),
                "age_minutes":  round(
                    (time.time() - _cache_updated_at[locality["name"]]) / 60, 1
                ) if locality["name"] in _cache_updated_at else None,
            }
            for locality in NOBROKER_LOCALITIES
        }
    return jsonify(status)


@app.route("/api/ingestion/status")
def ingestion_status():
    """Show DB listing counts by source, locality breakdown, and total."""
    source_counts = get_listing_counts()
    locality_breakdown = get_locality_counts()
    totals = total_listing_count()
    return jsonify({
        "total_listings": totals["active"],
        "total_listings_all": totals["total"],
        "by_source": source_counts,
        "by_locality": locality_breakdown,
    })


@app.route("/api/locality-feed/status")
def locality_feed_status():
    """Stats for the locality_feed table (news + Reddit discussions)."""
    try:
        from ingestion.db import get_connection
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT
                source,
                COUNT(*)                                                        AS total,
                COUNT(*) FILTER (WHERE scraped_at >= NOW() - INTERVAL '24 hours') AS last_24h,
                COUNT(*) FILTER (WHERE topic IS NULL OR sentiment IS NULL)      AS untagged,
                EXTRACT(EPOCH FROM MAX(scraped_at))::FLOAT                      AS newest_scraped,
                EXTRACT(EPOCH FROM MIN(scraped_at))::FLOAT                      AS oldest_scraped
            FROM locality_feed
            GROUP BY source
        """)
        rows = cur.fetchall()

        cur.execute("SELECT COUNT(*) FROM locality_feed")
        total = cur.fetchone()[0]

        cur.execute("""
            SELECT locality, COUNT(*) AS cnt
            FROM locality_feed
            WHERE scraped_at >= NOW() - INTERVAL '24 hours'
            GROUP BY locality
            ORDER BY cnt DESC
            LIMIT 20
        """)
        by_locality = {r[0]: r[1] for r in cur.fetchall()}

        conn.close()

        import time
        now = time.time()
        by_source = {}
        for row in rows:
            src, total_cnt, last_24h, untagged, newest, oldest = row
            by_source[src] = {
                "total": total_cnt,
                "last_24h": last_24h,
                "untagged": untagged,
                "newest_age_minutes": round((now - newest) / 60, 1) if newest else None,
                "oldest_age_minutes": round((now - oldest) / 60, 1) if oldest else None,
            }

        return jsonify({
            "total_posts": total,
            "by_source": by_source,
            "by_locality_24h": by_locality,
        })
    except Exception as e:
        logger.error("locality-feed/status error: %s", e)
        return jsonify({"error": str(e)}), 500


@app.route("/api/localities")
def localities_endpoint():
    """Return all locality data for the frontend (coords, radius, aliases)."""
    area = request.args.get("area", "").strip()
    data = get_locality_api_data()
    response = {"localities": data, "names": ALL_LOCALITY_NAMES}
    if area:
        expanded = expand_locality(area)
        response["expanded"] = expanded
        canonical = normalize_locality(area)
        response["canonical"] = canonical
    return jsonify(response)


def _posthog_query(hogql: str) -> dict:
    """Run a HogQL query against the PostHog API and return the raw result."""
    key = os.getenv("POSTHOG_PERSONAL_API_KEY")
    project_id = os.getenv("POSTHOG_PROJECT_ID")
    if not key or not project_id:
        return {"error": "PostHog credentials not configured"}
    resp = http.post(
        f"https://app.posthog.com/api/projects/{project_id}/query",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"query": {"kind": "HogQLQuery", "query": hogql}},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def _safe_posthog_query(hogql: str, label: str = "") -> dict:
    """Run a HogQL query, returning empty results instead of raising on failure."""
    try:
        return _posthog_query(hogql)
    except Exception as e:
        logger.warning("PostHog query failed [%s]: %s", label or hogql[:60], e)
        return {"results": []}


@app.route("/api/stats")
def stats():
    """
    Return PostHog analytics stats for the internal dashboard.
    Accepts ?period=24h|7d|30d|all (default: 30d).
    Protected by X-Stats-Token header matching STATS_SECRET env var.
    """
    token = request.headers.get("X-Stats-Token", "")
    expected = os.getenv("STATS_SECRET", "")
    if not expected or token != expected:
        return jsonify({"error": "unauthorized"}), 401

    period = request.args.get("period", "30d")
    PERIOD_INTERVALS = {"24h": "1 DAY", "7d": "7 DAY", "30d": "30 DAY", "all": None}
    interval = PERIOD_INTERVALS.get(period, "30 DAY")

    def time_filter(col="timestamp"):
        return f"AND {col} >= now() - INTERVAL {interval}" if interval else ""

    NO_INTERNAL = "(properties.internal_user IS NULL OR properties.internal_user != true)"

    try:
        # ── Unique visitors ──────────────────────────────────────────────────────
        visitors_res = _posthog_query(
            f"SELECT count(DISTINCT person_id) AS cnt FROM events "
            f"WHERE event = 'page_view' {time_filter()} AND {NO_INTERNAL}"
        )
        unique_visitors = visitors_res.get("results", [[0]])[0][0] if visitors_res.get("results") else 0

        # ── Total page views ─────────────────────────────────────────────────────
        views_res = _posthog_query(
            f"SELECT count() AS cnt FROM events "
            f"WHERE event = 'page_view' {time_filter()} AND {NO_INTERNAL}"
        )
        total_views = views_res.get("results", [[0]])[0][0] if views_res.get("results") else 0

        # ── Views today (always today, not period-dependent) ─────────────────────
        views_today_res = _posthog_query(
            f"SELECT count() AS cnt FROM events "
            f"WHERE event = 'page_view' "
            f"AND timestamp >= toStartOfDay(now()) AND {NO_INTERNAL}"
        )
        views_today = views_today_res.get("results", [[0]])[0][0] if views_today_res.get("results") else 0

        # ── New visitors (first-ever visit within the window) ────────────────────
        if interval:
            new_visitors_res = _safe_posthog_query(
                f"SELECT count(DISTINCT person_id) AS cnt FROM events "
                f"WHERE event = 'page_view' {time_filter()} AND {NO_INTERNAL} "
                f"AND person_id NOT IN ("
                f"  SELECT DISTINCT person_id FROM events "
                f"  WHERE event = 'page_view' "
                f"  AND timestamp < now() - INTERVAL {interval} AND {NO_INTERNAL}"
                f")",
                "new_visitors",
            )
            new_visitors = new_visitors_res.get("results", [[0]])[0][0] if new_visitors_res.get("results") else 0
            returning_visitors = max(0, unique_visitors - new_visitors)
        else:
            # All-time: everyone is "new" from some point; skip new/returning
            new_visitors = None
            returning_visitors = None

        # ── Average session duration ─────────────────────────────────────────────
        avg_session_res = _safe_posthog_query(
            f"SELECT avg(dur) FROM ("
            f"  SELECT properties.$session_id AS sid,"
            f"    dateDiff('second', min(timestamp), max(timestamp)) AS dur"
            f"  FROM events"
            f"  WHERE {time_filter('timestamp')[4:] if interval else '1=1'}"  # strip leading AND
            f"  AND {NO_INTERNAL}"
            f"  AND properties.$session_id IS NOT NULL"
            f"  AND properties.$session_id != ''"
            f"  GROUP BY sid"
            f") WHERE dur > 0",
            "avg_session",
        )
        avg_session_raw = avg_session_res.get("results", [[None]])[0][0] if avg_session_res.get("results") else None
        avg_session_seconds = round(float(avg_session_raw)) if avg_session_raw is not None else None

        # ── Daily/hourly sparkline ───────────────────────────────────────────────
        if period == "24h":
            spark_filter = "AND timestamp >= now() - INTERVAL 1 DAY"
            spark_group = "toStartOfHour(timestamp)"
            spark_label_col = "toString(toStartOfHour(timestamp))"
        elif period == "7d":
            spark_filter = "AND timestamp >= now() - INTERVAL 7 DAY"
            spark_group = "toDate(timestamp)"
            spark_label_col = "toString(toDate(timestamp))"
        elif period == "all":
            spark_filter = ""
            spark_group = "toStartOfMonth(timestamp)"
            spark_label_col = "toString(toStartOfMonth(timestamp))"
        else:
            spark_filter = "AND timestamp >= now() - INTERVAL 14 DAY"
            spark_group = "toDate(timestamp)"
            spark_label_col = "toString(toDate(timestamp))"

        daily_res = _posthog_query(
            f"SELECT {spark_label_col} AS period_label, count(DISTINCT person_id) AS cnt "
            f"FROM events "
            f"WHERE event = 'page_view' {spark_filter} AND {NO_INTERNAL} "
            f"GROUP BY {spark_group} "
            f"ORDER BY {spark_group} ASC"
        )
        daily = [
            {"date": str(row[0]), "visitors": row[1]}
            for row in (daily_res.get("results") or [])
        ]

        # ── Top routes ───────────────────────────────────────────────────────────
        routes_res = _posthog_query(
            f"SELECT properties.pathname AS route, count() AS cnt "
            f"FROM events "
            f"WHERE event = 'page_view' {time_filter()} AND {NO_INTERNAL} "
            f"GROUP BY route ORDER BY cnt DESC LIMIT 10"
        )
        routes = [
            {"route": row[0] or "/", "views": row[1]}
            for row in (routes_res.get("results") or [])
        ]

        # ── Page views by section ────────────────────────────────────────────────
        section_pages = {
            "pulse": "/locality-guide",
            "listing_detail": "/listing/%",
            "locality_guide": "/neighbourhood-pulse/%",
        }
        page_views = {}
        for key, path_pattern in section_pages.items():
            op = "LIKE" if "%" in path_pattern else "="
            pv_res = _safe_posthog_query(
                f"SELECT count() AS cnt FROM events "
                f"WHERE event = 'page_view' {time_filter()} AND {NO_INTERNAL} "
                f"AND properties.pathname {op} '{path_pattern}'",
                f"page_views_{key}",
            )
            page_views[key] = pv_res.get("results", [[0]])[0][0] if pv_res.get("results") else 0

        # ── Top locality guide pages ─────────────────────────────────────────────
        localities_res = _safe_posthog_query(
            f"SELECT properties.pathname AS route, count(DISTINCT person_id) AS uniq, count() AS cnt "
            f"FROM events "
            f"WHERE event = 'page_view' {time_filter()} AND {NO_INTERNAL} "
            f"AND properties.pathname LIKE '/neighbourhood-pulse/%' "
            f"GROUP BY route ORDER BY cnt DESC LIMIT 10",
            "top_localities",
        )
        top_localities = [
            {
                "locality": row[0].replace("/neighbourhood-pulse/", "").replace("-", " ").title() if row[0] else "",
                "slug": row[0],
                "unique_visitors": row[1],
                "views": row[2],
            }
            for row in (localities_res.get("results") or [])
        ]

        # ── Search count + top areas ─────────────────────────────────────────────
        search_count_res = _safe_posthog_query(
            f"SELECT count() AS cnt FROM events "
            f"WHERE event = 'search' {time_filter()} AND {NO_INTERNAL}",
            "search_count",
        )
        search_count = search_count_res.get("results", [[0]])[0][0] if search_count_res.get("results") else 0

        top_searches_res = _safe_posthog_query(
            f"SELECT properties.query AS q, count() AS cnt "
            f"FROM events "
            f"WHERE event = 'search' {time_filter()} AND {NO_INTERNAL} "
            f"AND properties.query IS NOT NULL AND properties.query != '' "
            f"GROUP BY q ORDER BY cnt DESC LIMIT 10",
            "top_searches",
        )
        top_searches = [
            {"query": row[0], "count": row[1]}
            for row in (top_searches_res.get("results") or [])
        ]

        # ── Listing clicks ───────────────────────────────────────────────────────
        listing_clicks_res = _safe_posthog_query(
            f"SELECT count() AS cnt FROM events "
            f"WHERE event = 'listing_click' {time_filter()} AND {NO_INTERNAL}",
            "listing_clicks",
        )
        listing_clicks = listing_clicks_res.get("results", [[0]])[0][0] if listing_clicks_res.get("results") else 0

        top_listings_res = _safe_posthog_query(
            f"SELECT properties.listing_id AS lid, count() AS cnt "
            f"FROM events "
            f"WHERE event = 'listing_click' {time_filter()} AND {NO_INTERNAL} "
            f"AND properties.listing_id IS NOT NULL "
            f"GROUP BY lid ORDER BY cnt DESC LIMIT 10",
            "top_listings",
        )
        top_listings = [
            {"listing_id": row[0], "views": row[1]}
            for row in (top_listings_res.get("results") or [])
        ]

        # ── App installs (PostHog event fired on PWA install) ────────────────────
        installs_res = _safe_posthog_query(
            "SELECT count() AS cnt FROM events WHERE event = 'app_installed'",
            "app_installs",
        )
        app_installs = installs_res.get("results", [[0]])[0][0] if installs_res.get("results") else 0

        # ── Login count (PostHog user_login events) ──────────────────────────────
        logins_res = _safe_posthog_query(
            f"SELECT count() AS cnt FROM events "
            f"WHERE event = 'user_login' {time_filter()} AND {NO_INTERNAL}",
            "login_count",
        )
        login_count = logins_res.get("results", [[0]])[0][0] if logins_res.get("results") else 0

        # ── All users + emails via PostHog persons table ─────────────────────────
        persons_res = _safe_posthog_query(
            "SELECT properties.email AS email, created_at "
            "FROM persons "
            "WHERE properties.email IS NOT NULL AND properties.email != '' "
            "ORDER BY created_at DESC "
            "LIMIT 500",
            "persons_emails",
        )
        login_emails = [
            row[0] for row in (persons_res.get("results") or []) if row[0]
        ]
        total_users = len(login_emails)

        # ── Saved listings count via Supabase REST ───────────────────────────────
        supabase_url = os.getenv("SUPABASE_URL", "")
        service_key = os.getenv("SUPABASE_SERVICE_KEY", "")
        saved_listings_total = 0
        saved_listings_users = 0
        if supabase_url and service_key:
            try:
                r = http.get(
                    f"{supabase_url}/rest/v1/saved_listings",
                    params={"select": "user_id"},
                    headers={
                        "apikey": service_key,
                        "Authorization": f"Bearer {service_key}",
                        "Prefer": "count=exact",
                        "Range-Unit": "items",
                        "Range": "0-999",
                    },
                    timeout=8,
                )
                if r.status_code in (200, 206):
                    rows = r.json() or []
                    saved_listings_total = len(rows)
                    saved_listings_users = len({row["user_id"] for row in rows if row.get("user_id")})
                    # If response hit the range limit, use Content-Range total
                    cr = r.headers.get("Content-Range", "")
                    if "/" in cr:
                        try:
                            saved_listings_total = int(cr.split("/")[-1])
                        except ValueError:
                            pass
                else:
                    logger.warning("Supabase saved_listings fetch failed: %s %s", r.status_code, r.text[:200])
            except Exception as e:
                logger.warning("Supabase saved_listings error: %s", e)

        return jsonify({
            "period": period,
            "unique_visitors": unique_visitors,
            "total_views": total_views,
            "views_today": views_today,
            "new_visitors": new_visitors,
            "returning_visitors": returning_visitors,
            "avg_session_seconds": avg_session_seconds,
            "daily_visitors": daily,
            "top_routes": routes,
            "page_views_pulse": page_views.get("pulse", 0),
            "page_views_listing_detail": page_views.get("listing_detail", 0),
            "page_views_locality_guide": page_views.get("locality_guide", 0),
            "top_localities": top_localities,
            "search_count": search_count,
            "top_searches": top_searches,
            "listing_clicks": listing_clicks,
            "top_listings": top_listings,
            "app_installs": app_installs,
            "login_count": login_count,
            "login_emails": sorted(login_emails),
            "total_users": total_users,
            "saved_listings_total": saved_listings_total,
            "saved_listings_users": saved_listings_users,
        })

    except Exception as e:
        logger.error("PostHog stats error: %s", e)
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────
# Pulse API
# ─────────────────────────────────────────────

def _get_pg_conn():
    """Get a direct psycopg2 connection for curated-table queries."""
    import psycopg2
    url = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("SUPABASE_DB_URL or DATABASE_URL must be set")
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return psycopg2.connect(url)


@app.route("/api/pulse/feed")
def pulse_feed():
    """
    Return curated Pulse feed posts.
    Featured posts first, then by relevance_score DESC.
    Optional filters: ?locality=, ?topic=, ?limit=
    """
    locality = request.args.get("locality", "").strip() or None
    topic = request.args.get("topic", "").strip() or None
    limit_val = min(int(request.args.get("limit", 50)), 100)

    conn = None
    try:
        conn = _get_pg_conn()
        cur = conn.cursor()

        where_clauses = []
        params = []

        if locality:
            where_clauses.append("(%s = ANY(lf.detected_localities) OR lf.locality ILIKE %s)")
            params.extend([locality, locality])
        if topic:
            where_clauses.append("lf.canonical_topic = %s")
            params.append(topic)

        where_sql = (" AND " + " AND ".join(where_clauses)) if where_clauses else ""
        params.append(limit_val)

        cur.execute(f"""
            SELECT
                lf.id, lf.source, lf.locality, lf.title, lf.body, lf.url,
                lf.category, lf.canonical_topic, lf.sentiment_score,
                lf.relevance_score, lf.detected_localities,
                lf.posted_at, lf.scraped_at, lf.engagement, lf.author,
                fc.featured, fc.editor_rank, fc.editor_note,
                fc.is_trending, fc.trending_score
            FROM feed_curated fc
            JOIN locality_feed lf ON lf.id = fc.feed_id
            WHERE lf.category IN ('discussion', 'news')
              AND lf.relevance_score >= 0.3
              AND lf.scraped_at >= NOW() - INTERVAL '7 days'
              {where_sql}
            ORDER BY fc.featured DESC, fc.editor_rank ASC NULLS LAST,
                     (lf.relevance_score * EXP(-0.5 * EXTRACT(EPOCH FROM NOW() - lf.scraped_at) / 86400.0)) DESC,
                     lf.scraped_at DESC
            LIMIT %s
        """, params)

        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, row)) for row in cur.fetchall()]
        for r in rows:
            for k, v in r.items():
                if hasattr(v, "isoformat"):
                    r[k] = v.isoformat()

        # City-wide sentiment (all posts, last 7 days).
        # Intentionally a shorter window than per-locality / scoring (30d): the
        # city pulse is meant to feel "live" and respond to current chatter,
        # while the per-locality and listing scores favour a more stable
        # 30-day baseline. The "(7d)" label on the UI signposts this clearly.
        cur.execute("""
            SELECT AVG(sentiment_score), COUNT(*), MAX(scraped_at)
            FROM locality_feed
            WHERE category IN ('discussion', 'news')
              AND sentiment_score IS NOT NULL
              AND relevance_score >= 0.3
              AND scraped_at >= NOW() - INTERVAL '7 days'
        """)
        avg_sent, sent_count, last_scraped = cur.fetchone()

        # Per-locality sentiment (last 30 days)
        # Posts are credited both to their direct `locality` AND to any locality
        # mentioned in `detected_localities`, so a Reddit thread about HSR that
        # references Whitefield contributes to BOTH localities. Using UNION on
        # post id deduplicates so a post tagged AND mentioning the same place
        # only counts once. This mirrors /api/pulse/locality/<locality>.
        cur.execute("""
            WITH expanded AS (
                SELECT id, locality, sentiment_score
                FROM locality_feed
                WHERE category IN ('discussion', 'news')
                  AND locality IS NOT NULL
                  AND sentiment_score IS NOT NULL
                  AND relevance_score >= 0.3
                  AND scraped_at >= NOW() - INTERVAL '30 days'
                UNION
                SELECT id, unnest(detected_localities) AS locality, sentiment_score
                FROM locality_feed
                WHERE category IN ('discussion', 'news')
                  AND detected_localities IS NOT NULL
                  AND array_length(detected_localities, 1) > 0
                  AND sentiment_score IS NOT NULL
                  AND relevance_score >= 0.3
                  AND scraped_at >= NOW() - INTERVAL '30 days'
            )
            SELECT locality, AVG(sentiment_score) AS avg_sent, COUNT(*) AS cnt
            FROM expanded
            -- "Bengaluru General" is a catch-all bucket the locality tagger
            -- assigns to posts about the city in general; exclude it from the
            -- per-locality breakdown since it isn't an actual neighbourhood.
            WHERE locality NOT ILIKE 'bengaluru general'
              AND locality NOT ILIKE 'bangalore general'
            GROUP BY locality
            ORDER BY cnt DESC
            LIMIT 20
        """)
        locality_sentiments = [
            {"locality": loc, "avg_sentiment": round(float(s), 3), "count": c}
            for loc, s, c in cur.fetchall()
        ]

        return jsonify({
            "posts": rows,
            "city_sentiment": round(float(avg_sent), 3) if avg_sent else 0,
            "city_sentiment_count": sent_count or 0,
            "city_sentiment_updated_at": last_scraped.isoformat() if last_scraped else None,
            "locality_sentiments": locality_sentiments,
        })

    except Exception as e:
        logger.error("pulse/feed error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route("/api/pulse/topics")
def pulse_topics():
    """
    Aggregate canonical_topic counts + avg sentiment from feed_curated
    for the last 30 days.
    """
    conn = None
    try:
        conn = _get_pg_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT
                lf.canonical_topic,
                COUNT(*) AS post_count,
                AVG(lf.sentiment_score) AS avg_sentiment
            FROM feed_curated fc
            JOIN locality_feed lf ON lf.id = fc.feed_id
            WHERE lf.canonical_topic IS NOT NULL
              AND lf.canonical_topic != 'other'
              AND lf.scraped_at >= NOW() - INTERVAL '30 days'
            GROUP BY lf.canonical_topic
            ORDER BY post_count DESC
        """)
        topics = []
        for slug, count, avg_sent in cur.fetchall():
            topics.append({
                "slug": slug,
                "label": slug.replace("_", " ").title(),
                "count": count,
                "avg_sentiment": round(float(avg_sent), 3) if avg_sent else 0,
            })

        return jsonify({"topics": topics})

    except Exception as e:
        logger.error("pulse/topics error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route("/api/pulse/trending")
def pulse_trending():
    """Return trending posts from feed_curated."""
    conn = None
    try:
        conn = _get_pg_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT
                lf.id, lf.source, lf.locality, lf.title, lf.body, lf.url,
                lf.category, lf.canonical_topic, lf.sentiment_score,
                lf.relevance_score, lf.detected_localities,
                lf.posted_at, lf.scraped_at, lf.engagement,
                fc.trending_score
            FROM feed_curated fc
            JOIN locality_feed lf ON lf.id = fc.feed_id
            WHERE fc.is_trending = TRUE
            ORDER BY fc.trending_score DESC
        """)
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, row)) for row in cur.fetchall()]
        for r in rows:
            for k, v in r.items():
                if hasattr(v, "isoformat"):
                    r[k] = v.isoformat()

        return jsonify({"trending": rows})

    except Exception as e:
        logger.error("pulse/trending error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route("/api/pulse/locality/<locality>")
def pulse_locality(locality):
    """
    Locality-specific sentiment summary: 30-day avg sentiment,
    top topics by post count, recent high-relevance posts.

    The 30-day window + discussion/news filter mirrors what /api/pulse/feed
    uses for the city-overview locality breakdown, so the same locality always
    shows the same sentiment score regardless of which page the user is on.
    """
    conn = None
    try:
        conn = _get_pg_conn()
        cur = conn.cursor()

        # 30-day avg sentiment for this locality (kept in sync with /api/pulse/feed
        # and slow_path._load_locality_sentiment so all three places agree).
        cur.execute("""
            SELECT AVG(sentiment_score), COUNT(*)
            FROM locality_feed
            WHERE (locality ILIKE %s OR %s = ANY(detected_localities))
              AND category IN ('discussion', 'news')
              AND sentiment_score IS NOT NULL
              AND relevance_score >= 0.3
              AND scraped_at >= NOW() - INTERVAL '30 days'
        """, (locality, locality))
        avg_sent, post_count_30d = cur.fetchone()

        # Top topics (last 30 days)
        cur.execute("""
            SELECT canonical_topic, COUNT(*) AS cnt, AVG(sentiment_score) AS avg_sent
            FROM locality_feed
            WHERE (locality ILIKE %s OR %s = ANY(detected_localities))
              AND canonical_topic IS NOT NULL
              AND canonical_topic != 'other'
              AND scraped_at >= NOW() - INTERVAL '30 days'
            GROUP BY canonical_topic
            ORDER BY cnt DESC
            LIMIT 8
        """, (locality, locality))
        topics = [
            {"slug": slug, "label": slug.replace("_", " ").title(),
             "count": cnt, "avg_sentiment": round(float(s), 3) if s else 0}
            for slug, cnt, s in cur.fetchall()
        ]

        # Recent high-relevance posts
        cur.execute("""
            SELECT id, source, locality, title, body, url,
                   category, canonical_topic, sentiment_score,
                   relevance_score, posted_at, scraped_at, engagement
            FROM locality_feed
            WHERE (locality ILIKE %s OR %s = ANY(detected_localities))
              AND category IN ('discussion', 'news')
              AND relevance_score >= 0.4
            ORDER BY scraped_at DESC
            LIMIT 20
        """, (locality, locality))
        cols = [d[0] for d in cur.description]
        posts = [dict(zip(cols, row)) for row in cur.fetchall()]
        for p in posts:
            for k, v in p.items():
                if hasattr(v, "isoformat"):
                    p[k] = v.isoformat()

        return jsonify({
            "locality": locality,
            "avg_sentiment_30d": round(float(avg_sent), 3) if avg_sent else None,
            "post_count_30d": post_count_30d or 0,
            # Backward-compat aliases — older clients still read the *_7d names.
            # The data is now actually a 30-day rolling window.
            "avg_sentiment_7d": round(float(avg_sent), 3) if avg_sent else None,
            "post_count_7d": post_count_30d or 0,
            "topics": topics,
            "recent_posts": posts,
        })

    except Exception as e:
        logger.error("pulse/locality error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


# ─────────────────────────────────────────────
# Locality Stats API
# ─────────────────────────────────────────────

@app.route("/api/locality-stats/<locality>")
def locality_stats(locality):
    """
    Return rent stats (median, P25, P75, price_per_sqft) + deposit stats
    for a locality, per BHK. Replaces direct Supabase queries.
    """
    conn = None
    try:
        conn = _get_pg_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT bhk, median_rent, p25_rent, p75_rent, listing_count,
                   rent_trend_pct, median_price_per_sqft, updated_at
            FROM locality_stats_cache
            WHERE locality ILIKE %s
            ORDER BY bhk
        """, (locality,))
        cols = [d[0] for d in cur.description]
        rent_rows = [dict(zip(cols, row)) for row in cur.fetchall()]
        for r in rent_rows:
            for k, v in r.items():
                if hasattr(v, "isoformat"):
                    r[k] = v.isoformat()
                elif isinstance(v, Decimal):
                    r[k] = float(v)

        cur.execute("""
            SELECT bhk, avg_multiplier, median_deposit
            FROM deposit_stats_cache
            ORDER BY bhk
        """)
        cols2 = [d[0] for d in cur.description]
        deposit_rows = [dict(zip(cols2, row)) for row in cur.fetchall()]
        for r in deposit_rows:
            for k, v in r.items():
                if isinstance(v, Decimal):
                    r[k] = float(v)

        return jsonify({
            "locality": locality,
            "rent_stats": rent_rows,
            "deposit_stats": deposit_rows,
        })

    except Exception as e:
        logger.error("locality-stats error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route("/api/pulse/rent-overview")
def pulse_rent_overview():
    """All locality rent stats for Pulse sidebar."""
    conn = None
    try:
        conn = _get_pg_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT locality, bhk, median_rent, rent_trend_pct
            FROM locality_stats_cache
            WHERE median_rent IS NOT NULL
            ORDER BY median_rent DESC
        """)
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, row)) for row in cur.fetchall()]
        for r in rows:
            for k, v in r.items():
                if isinstance(v, Decimal):
                    r[k] = float(v)
        return jsonify({"rent_data": rows})
    except Exception as e:
        logger.error("pulse/rent-overview error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route("/api/pulse/bangalore-rent-trend")
def bangalore_rent_trend():
    """Rolling 30-day city-wide rent trend for Bangalore, grouped by BHK."""
    conn = None
    try:
        conn = _get_pg_conn()
        cur = conn.cursor()
        cur.execute("""
            WITH current_period AS (
                SELECT bhk,
                       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY rent)::integer AS median_rent,
                       COUNT(*) AS listing_count
                FROM listings
                WHERE status IN ('active', 'stale')
                  AND rent IS NOT NULL
                  AND rent BETWEEN 3000 AND 500000
                  AND bhk IN ('1 BHK', '2 BHK', '3 BHK')
                  AND source IN ('nobroker', 'housing')
                  AND listing_type = 'full_house'
                GROUP BY bhk
                HAVING COUNT(*) >= 30
            ),
            previous_period AS (
                SELECT bhk,
                       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY rent)::integer AS median_rent
                FROM listings
                WHERE first_seen_at < NOW() - INTERVAL '30 days'
                  AND rent IS NOT NULL
                  AND rent BETWEEN 3000 AND 500000
                  AND bhk IN ('1 BHK', '2 BHK', '3 BHK')
                  AND source IN ('nobroker', 'housing')
                  AND listing_type = 'full_house'
                GROUP BY bhk
                HAVING COUNT(*) >= 30
            )
            SELECT
                c.bhk,
                c.median_rent AS current_median,
                p.median_rent AS prior_median,
                c.listing_count,
                CASE
                    WHEN p.median_rent IS NOT NULL AND p.median_rent > 0
                    THEN ROUND(((c.median_rent - p.median_rent)::numeric / p.median_rent) * 100, 1)
                    ELSE NULL
                END AS trend_pct
            FROM current_period c
            LEFT JOIN previous_period p USING (bhk)
            ORDER BY c.bhk
        """)
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, row)) for row in cur.fetchall()]
        for r in rows:
            for k, v in r.items():
                if isinstance(v, Decimal):
                    r[k] = float(v)
        return jsonify({"bhk_trends": rows})
    except Exception as e:
        logger.error("pulse/bangalore-rent-trend error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route("/api/locality-stats-all")
def locality_stats_all():
    """All locality stats + deposit benchmarks for LocalityGuide overview."""
    conn = None
    try:
        conn = _get_pg_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT locality, bhk, median_rent, p25_rent, p75_rent,
                   listing_count, rent_trend_pct, median_price_per_sqft, updated_at
            FROM locality_stats_cache
            ORDER BY median_rent DESC
        """)
        cols = [d[0] for d in cur.description]
        rent_rows = [dict(zip(cols, row)) for row in cur.fetchall()]
        for r in rent_rows:
            for k, v in r.items():
                if hasattr(v, "isoformat"):
                    r[k] = v.isoformat()
                elif isinstance(v, Decimal):
                    r[k] = float(v)

        cur.execute("""
            SELECT bhk, avg_multiplier, median_deposit
            FROM deposit_stats_cache
            ORDER BY bhk
        """)
        cols2 = [d[0] for d in cur.description]
        dep_rows = [dict(zip(cols2, row)) for row in cur.fetchall()]
        for r in dep_rows:
            for k, v in r.items():
                if isinstance(v, Decimal):
                    r[k] = float(v)

        return jsonify({"locality_stats": rent_rows, "deposit_stats": dep_rows})
    except Exception as e:
        logger.error("locality-stats-all error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route("/api/locality-image/<locality>")
def locality_image(locality):
    """Return hero image for a locality."""
    conn = None
    try:
        conn = _get_pg_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT image_url, attribution
            FROM locality_images
            WHERE locality ILIKE %s
            LIMIT 1
        """, (locality,))
        row = cur.fetchone()
        if row:
            return jsonify({"image_url": row[0], "attribution": row[1]})
        return jsonify({}), 200
    except Exception as e:
        logger.error("locality-image error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route("/api/pulse/feed-for-locality/<locality>")
def pulse_feed_for_locality(locality):
    """Topic counts + recent posts for a specific locality (30d window)."""
    conn = None
    try:
        conn = _get_pg_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT canonical_topic, COUNT(*) AS cnt
            FROM locality_feed
            WHERE (locality ILIKE %s OR %s = ANY(detected_localities))
              AND canonical_topic IS NOT NULL
              AND scraped_at >= NOW() - INTERVAL '30 days'
            GROUP BY canonical_topic
            ORDER BY cnt DESC
        """, (locality, locality))
        topics = [{"topic": t, "count": c} for t, c in cur.fetchall()]

        cur.execute("""
            SELECT id, source, author, locality, title, body, url,
                   canonical_topic AS topic, sentiment_score AS sentiment,
                   engagement, posted_at
            FROM locality_feed
            WHERE (locality ILIKE %s OR %s = ANY(detected_localities))
              AND canonical_topic IS NOT NULL
              AND sentiment_score IS NOT NULL
            ORDER BY posted_at DESC
            LIMIT 30
        """, (locality, locality))
        cols = [d[0] for d in cur.description]
        posts = [dict(zip(cols, row)) for row in cur.fetchall()]
        for p in posts:
            for k, v in p.items():
                if hasattr(v, "isoformat"):
                    p[k] = v.isoformat()
                elif isinstance(v, Decimal):
                    p[k] = float(v)

        return jsonify({"topics": topics, "posts": posts})
    except Exception as e:
        logger.error("pulse/feed-for-locality error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


# ─────────────────────────────────────────────
# Pipeline Status
# ─────────────────────────────────────────────

@app.route("/api/pipeline-status")
def pipeline_status():
    """
    Return ingestion pipeline health dashboard.
    Queries the new ingestion_runs and listings tables in Supabase.
    """
    try:
        from listing_store import _get_conn, _put_conn
        conn, is_pg = _get_conn()
        if not is_pg:
            return jsonify({"error": "Pipeline status requires Postgres"}), 500
        cur = conn.cursor()

        # Last 5 runs per source
        cur.execute("""
            SELECT source, started_at, finished_at, status,
                   total_fetched, total_new, total_updated, total_stale,
                   total_errors, duration_ms, error_message
            FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY source ORDER BY started_at DESC) AS rn
                FROM ingestion_runs
            ) t
            WHERE rn <= 5
            ORDER BY source, started_at DESC
        """)
        cols = [d[0] for d in cur.description]
        recent_runs = [dict(zip(cols, row)) for row in cur.fetchall()]

        # Active / stale / expired counts per source
        cur.execute("""
            SELECT source, status, COUNT(*) as cnt
            FROM listings
            GROUP BY source, status
            ORDER BY source, status
        """)
        status_counts = {}
        for source, status_val, cnt in cur.fetchall():
            status_counts.setdefault(source, {})[status_val] = cnt

        # Total listings
        cur.execute("SELECT COUNT(*) FROM listings")
        total = cur.fetchone()[0]

        # Listings per locality (active only)
        cur.execute("""
            SELECT locality, COUNT(*) as cnt
            FROM listings
            WHERE status = 'active' AND locality IS NOT NULL
            GROUP BY locality
            ORDER BY cnt DESC
            LIMIT 30
        """)
        locality_counts = {row[0]: row[1] for row in cur.fetchall()}

        for run in recent_runs:
            for k, v in run.items():
                if hasattr(v, 'isoformat'):
                    run[k] = v.isoformat()

        # Transform runs (last 5 per job)
        cur.execute("""
            SELECT job_name, source, started_at, finished_at, status,
                   duration_ms, records_processed, records_failed,
                   gemini_calls, gemini_fallback_count, error_message
            FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY job_name ORDER BY started_at DESC) AS rn
                FROM transform_runs
            ) t
            WHERE rn <= 5
            ORDER BY job_name, started_at DESC
        """)
        tcols = [d[0] for d in cur.description]
        transform_runs = [dict(zip(tcols, row)) for row in cur.fetchall()]
        for tr in transform_runs:
            for k, v in tr.items():
                if hasattr(v, 'isoformat'):
                    tr[k] = v.isoformat()

        # Gemini fallback pending counts
        cur.execute("""
            SELECT
                (SELECT COUNT(*) FROM listings_curated WHERE gemini_fallback = TRUE) AS listings_pending,
                (SELECT COUNT(*) FROM feed_curated WHERE gemini_fallback = TRUE) AS feed_pending
        """)
        pend = cur.fetchone()
        gemini_pending = {
            "listings_curated": pend[0] if pend else 0,
            "feed_curated": pend[1] if pend else 0,
        }

        return jsonify({
            "total_listings": total,
            "by_source_status": status_counts,
            "by_locality": locality_counts,
            "recent_runs": recent_runs,
            "transform_runs": transform_runs,
            "gemini_fallback_pending": gemini_pending,
        })

    except Exception as e:
        logger.error("pipeline-status error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        _put_conn(conn)


# ─────────────────────────────────────────────
# Listing Statuses (batch) — used by My Hub for stale badges
# ─────────────────────────────────────────────

@app.route("/api/listing-statuses", methods=["POST"])
def listing_statuses():
    """Return { composite_id: status } for a batch of composite listing IDs (source_sourceId)."""
    conn = None
    try:
        body = request.get_json(silent=True) or {}
        ids = body.get("ids", [])
        if not ids or not isinstance(ids, list):
            return jsonify({})
        ids = [str(i) for i in ids[:200]]

        pairs = []
        for cid in ids:
            if '_' in cid:
                src, sid = cid.split('_', 1)
                src_map = {'nb': 'nobroker'}
                pairs.append((src_map.get(src, src), sid))

        if not pairs:
            return jsonify({})

        conn = _get_pg_conn()
        cur = conn.cursor()
        values_sql = ",".join(
            cur.mogrify("(%s,%s)", p).decode() for p in pairs
        )
        cur.execute(f"""
            SELECT l.source, l.source_id, l.status
            FROM listings l
            JOIN (VALUES {values_sql}) AS v(src, sid)
              ON l.source = v.src AND l.source_id = v.sid
        """)
        result = {}
        for source, source_id, status in cur.fetchall():
            result[f"{source}_{source_id}"] = status
        return jsonify(result)
    except Exception as e:
        logger.error("listing-statuses error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


# ─────────────────────────────────────────────
# Email subscription & digest routes
# ─────────────────────────────────────────────

from email_tokens import verify_token, ACTION_UNSUBSCRIBE_TYPE, ACTION_UNSUBSCRIBE_ALL, ACTION_CHANGE_FREQUENCY
from email_service import (
    send_welcome_email,
    posthog_capture,
    action_success_html,
    action_error_html,
    FREQUENCY_LABELS,
)


@app.route("/api/email/init-subscription", methods=["POST"])
def email_init_subscription():
    """Auto-subscribe a user on sign-in and send the welcome email (once)."""
    body = request.get_json(silent=True) or {}
    user_id = (body.get("user_id") or "").strip()
    email = (body.get("email") or "").strip()
    if not user_id or not email:
        return jsonify({"error": "user_id and email required"}), 400

    conn = None
    try:
        conn = _get_pg_conn()
        cur = conn.cursor()

        cur.execute(
            """
            INSERT INTO email_subscriptions
                (user_id, email, new_listings_email_subscribed, new_listings_frequency,
                 created_at, updated_at)
            VALUES (%s, %s, true, 'daily', NOW(), NOW())
            ON CONFLICT (user_id) DO UPDATE SET
                email = EXCLUDED.email,
                updated_at = NOW()
            """,
            (user_id, email),
        )
        conn.commit()

        # Atomically claim the welcome send — only one request can succeed
        cur.execute(
            """
            UPDATE email_subscriptions
            SET welcome_sent_at = NOW()
            WHERE user_id = %s AND welcome_sent_at IS NULL
            RETURNING user_id
            """,
            (user_id,),
        )
        should_send_welcome = cur.fetchone() is not None
        conn.commit()

        welcome_sent = False
        if should_send_welcome:
            ok, detail = send_welcome_email(email, user_id)
            if ok:
                welcome_sent = True
                posthog_capture(user_id, "email_alert_sent", {"type": "welcome", "email": email})
            else:
                # Reset so it can be retried next sign-in
                cur.execute(
                    "UPDATE email_subscriptions SET welcome_sent_at = NULL WHERE user_id = %s",
                    (user_id,),
                )
                conn.commit()
                logger.warning("Welcome email failed for %s: %s", email, detail)

        return jsonify({"ok": True, "welcome_sent": welcome_sent})
    except Exception as e:
        logger.error("email init-subscription error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route("/api/email/preferences", methods=["GET"])
def email_preferences_get():
    """Return the email subscription state for a user."""
    user_id = request.args.get("user_id", "").strip()
    if not user_id:
        return jsonify({"error": "user_id required"}), 400

    conn = None
    try:
        conn = _get_pg_conn()
        cur = conn.cursor()
        cur.execute(
            """SELECT new_listings_email_subscribed, new_listings_frequency,
                      all_emails_unsubscribed, last_digest_sent_at,
                      disabled_localities
               FROM email_subscriptions WHERE user_id = %s""",
            (user_id,),
        )
        row = cur.fetchone()
        if not row:
            return jsonify({
                "exists": False,
                "new_listings_email_subscribed": False,
                "new_listings_frequency": "daily",
                "all_emails_unsubscribed": False,
                "disabled_localities": [],
            })
        return jsonify({
            "exists": True,
            "new_listings_email_subscribed": row[0],
            "new_listings_frequency": row[1],
            "all_emails_unsubscribed": row[2],
            "last_digest_sent_at": row[3].isoformat() if row[3] else None,
            "disabled_localities": row[4] or [],
        })
    except Exception as e:
        logger.error("email preferences GET error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route("/api/email/preferences", methods=["PUT"])
def email_preferences_put():
    """Update email subscription preferences."""
    body = request.get_json(silent=True) or {}
    user_id = (body.get("user_id") or "").strip()
    if not user_id:
        return jsonify({"error": "user_id required"}), 400

    conn = None
    try:
        conn = _get_pg_conn()
        cur = conn.cursor()

        # Read current state for change detection
        cur.execute(
            "SELECT new_listings_email_subscribed, new_listings_frequency, all_emails_unsubscribed FROM email_subscriptions WHERE user_id = %s",
            (user_id,),
        )
        old = cur.fetchone()
        if not old:
            return jsonify({"error": "no subscription found"}), 404

        new_sub = body.get("new_listings_email_subscribed")
        new_freq = body.get("new_listings_frequency")
        unsub_all = body.get("all_emails_unsubscribed")
        disabled_locs = body.get("disabled_localities")

        sets, params = [], []
        if new_sub is not None:
            sets.append("new_listings_email_subscribed = %s")
            params.append(bool(new_sub))
        if new_freq and new_freq in FREQUENCY_LABELS:
            sets.append("new_listings_frequency = %s")
            params.append(new_freq)
        if unsub_all is not None:
            sets.append("all_emails_unsubscribed = %s")
            params.append(bool(unsub_all))
            if bool(unsub_all):
                sets.append("new_listings_email_subscribed = false")
        if disabled_locs is not None and isinstance(disabled_locs, list):
            sets.append("disabled_localities = %s")
            params.append(disabled_locs)

        if not sets:
            return jsonify({"ok": True, "changed": False})

        sets.append("updated_at = NOW()")
        params.append(user_id)
        cur.execute(
            f"UPDATE email_subscriptions SET {', '.join(sets)} WHERE user_id = %s",
            params,
        )
        conn.commit()

        # Fire PostHog events
        if new_sub is not None and not new_sub and old[0]:
            posthog_capture(user_id, "email_alert_unsubscribed", {
                "type": "new_listings_digest", "source": "preferences_page",
            })
        if unsub_all and not old[2]:
            posthog_capture(user_id, "email_alert_unsubscribed", {
                "type": "all", "source": "preferences_page",
            })
        if new_freq and new_freq != old[1]:
            posthog_capture(user_id, "email_alert_frequency_changed", {
                "new_frequency": new_freq, "source": "preferences_page",
            })

        return jsonify({"ok": True, "changed": True})
    except Exception as e:
        logger.error("email preferences PUT error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route("/api/email/action")
def email_action():
    """One-click email action via signed token (unsubscribe, frequency change)."""
    token = request.args.get("token", "")
    if not token:
        return action_error_html("Missing link token"), 400

    data = verify_token(token)
    if not data:
        return action_error_html("This link has expired"), 200

    user_id = data["uid"]
    action = data["act"]
    value = data.get("val", "")

    conn = None
    try:
        conn = _get_pg_conn()
        cur = conn.cursor()

        if action == ACTION_UNSUBSCRIBE_TYPE:
            cur.execute(
                "UPDATE email_subscriptions SET new_listings_email_subscribed = false, updated_at = NOW() WHERE user_id = %s",
                (user_id,),
            )
            conn.commit()
            posthog_capture(user_id, "email_alert_unsubscribed", {
                "type": value or "new_listings_digest", "source": "footer_one_click",
            })
            return action_success_html("You've been unsubscribed from new listing emails"), 200

        elif action == ACTION_UNSUBSCRIBE_ALL:
            cur.execute(
                "UPDATE email_subscriptions SET all_emails_unsubscribed = true, new_listings_email_subscribed = false, updated_at = NOW() WHERE user_id = %s",
                (user_id,),
            )
            conn.commit()
            posthog_capture(user_id, "email_alert_unsubscribed", {
                "type": "all", "source": "footer_one_click",
            })
            return action_success_html("You've been unsubscribed from all NestIQ emails"), 200

        elif action == ACTION_CHANGE_FREQUENCY:
            if value not in FREQUENCY_LABELS:
                return action_error_html("Invalid frequency"), 400
            cur.execute(
                "UPDATE email_subscriptions SET new_listings_frequency = %s, updated_at = NOW() WHERE user_id = %s",
                (value, user_id),
            )
            conn.commit()
            posthog_capture(user_id, "email_alert_frequency_changed", {
                "new_frequency": value, "source": "email_footer",
            })
            label = FREQUENCY_LABELS[value]
            return action_success_html(f"Digest frequency changed to {label}"), 200

        return action_error_html("Unknown action"), 400
    except Exception as e:
        logger.error("email action error: %s", e)
        return action_error_html("Something went wrong"), 500
    finally:
        if conn:
            conn.close()


@app.route("/api/resend/webhook", methods=["POST"])
def resend_webhook():
    """Handle Resend bounce / spam-complaint webhooks."""
    payload = request.get_data()
    event_data = request.get_json(silent=True) or {}

    event_type = event_data.get("type", "")
    email_data = event_data.get("data", {})
    recipient = ""

    if isinstance(email_data.get("to"), list) and email_data["to"]:
        recipient = email_data["to"][0]
    elif isinstance(email_data.get("email"), str):
        recipient = email_data["email"]

    if not recipient:
        return jsonify({"ok": True, "skipped": "no recipient"}), 200

    conn = None
    try:
        conn = _get_pg_conn()
        cur = conn.cursor()

        if event_type == "email.bounced":
            cur.execute(
                """UPDATE email_subscriptions
                   SET hard_bounce_at = NOW(), new_listings_email_subscribed = false, updated_at = NOW()
                   WHERE email = %s AND hard_bounce_at IS NULL""",
                (recipient,),
            )
            conn.commit()
            # Look up user_id for PostHog
            cur.execute("SELECT user_id FROM email_subscriptions WHERE email = %s", (recipient,))
            row = cur.fetchone()
            if row:
                posthog_capture(str(row[0]), "email_alert_unsubscribed", {
                    "type": "new_listings_digest", "source": "bounce",
                })

        elif event_type == "email.complained":
            cur.execute(
                """UPDATE email_subscriptions
                   SET spam_complaint_at = NOW(), new_listings_email_subscribed = false, updated_at = NOW()
                   WHERE email = %s AND spam_complaint_at IS NULL""",
                (recipient,),
            )
            conn.commit()
            cur.execute("SELECT user_id FROM email_subscriptions WHERE email = %s", (recipient,))
            row = cur.fetchone()
            if row:
                posthog_capture(str(row[0]), "email_alert_unsubscribed", {
                    "type": "new_listings_digest", "source": "spam_complaint",
                })

        return jsonify({"ok": True, "event": event_type}), 200
    except Exception as e:
        logger.error("resend webhook error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route("/api/email/verify-token", methods=["POST"])
def email_verify_token():
    """Verify a signed email token and return the user_id (for preferences page access)."""
    body = request.get_json(silent=True) or {}
    token = (body.get("token") or "").strip()
    if not token:
        return jsonify({"error": "token required"}), 400

    data = verify_token(token)
    if not data:
        return jsonify({"error": "invalid or expired token"}), 401
    return jsonify({"user_id": data["uid"]})


if __name__ == "__main__":
    port  = int(os.environ.get("PORT", 5001))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(debug=debug, host="0.0.0.0", port=port)
