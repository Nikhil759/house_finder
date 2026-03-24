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
    get_listing_counts,
    get_locality_counts,
    purge_old_listings,
    total_listing_count,
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
    )

    if db_posts:
        all_posts += db_posts
        from_db = True

    # Check which sources came back from DB; live-fetch any missing ones
    found_sources = {p.get("source") for p in db_posts} if db_posts else set()
    missing_sources = [s for s in source_list if s not in found_sources]

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

    # Score every post
    for post in all_posts:
        post["quality_score"] = score_post(post)

    # Filter out low-quality posts
    all_posts = [p for p in all_posts if p["quality_score"] >= min_score]

    # Sort
    if sort == "newest":
        all_posts.sort(key=lambda x: x.get("created", x.get("created_utc", 0)), reverse=True)
    elif sort == "upvotes":
        all_posts.sort(key=lambda x: x.get("score", 0), reverse=True)
    else:
        all_posts.sort(key=lambda x: x["quality_score"], reverse=True)

    locality_warning    = bool(area and not canonical_area)
    locality_suggestion = suggest_locality(area) if locality_warning else None

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
        post["quality_score"] = score_post(post)

    all_posts = [p for p in all_posts if p["quality_score"] >= 20]
    all_posts.sort(key=lambda x: x["quality_score"], reverse=True)

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
    total = total_listing_count()
    return jsonify({
        "total_listings": total,
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


@app.route("/api/stats")
def stats():
    """
    Return PostHog analytics stats for the internal dashboard.
    Protected by a simple owner-email check via query param.
    Real auth happens on the frontend via Supabase; this endpoint
    is low-risk (read-only analytics) so a shared secret is sufficient.
    """
    owner_email = "bn5799@gmail.com"
    token = request.headers.get("X-Stats-Token", "")
    expected = os.getenv("STATS_SECRET", "")
    if not expected or token != expected:
        return jsonify({"error": "unauthorized"}), 401

    try:
        # Unique visitors last 30 days (excluding internal)
        visitors_res = _posthog_query(
            "SELECT count(DISTINCT person_id) AS cnt "
            "FROM events "
            "WHERE event = 'page_view' "
            "AND timestamp >= now() - INTERVAL 30 DAY "
            "AND (properties.internal_user IS NULL OR properties.internal_user != true)"
        )
        visitors = visitors_res.get("results", [[0]])[0][0] if visitors_res.get("results") else 0

        # Total page views last 30 days (excluding internal)
        views_res = _posthog_query(
            "SELECT count() AS cnt "
            "FROM events "
            "WHERE event = 'page_view' "
            "AND timestamp >= now() - INTERVAL 30 DAY "
            "AND (properties.internal_user IS NULL OR properties.internal_user != true)"
        )
        total_views = views_res.get("results", [[0]])[0][0] if views_res.get("results") else 0

        # Page views today
        views_today_res = _posthog_query(
            "SELECT count() AS cnt "
            "FROM events "
            "WHERE event = 'page_view' "
            "AND timestamp >= toStartOfDay(now()) "
            "AND (properties.internal_user IS NULL OR properties.internal_user != true)"
        )
        views_today = views_today_res.get("results", [[0]])[0][0] if views_today_res.get("results") else 0

        # Views per route last 30 days
        routes_res = _posthog_query(
            "SELECT properties.pathname AS route, count() AS cnt "
            "FROM events "
            "WHERE event = 'page_view' "
            "AND timestamp >= now() - INTERVAL 30 DAY "
            "AND (properties.internal_user IS NULL OR properties.internal_user != true) "
            "GROUP BY route "
            "ORDER BY cnt DESC "
            "LIMIT 10"
        )
        routes = [
            {"route": row[0] or "/", "views": row[1]}
            for row in (routes_res.get("results") or [])
        ]

        # Daily unique visitors last 14 days for sparkline
        daily_res = _posthog_query(
            "SELECT toDate(timestamp) AS day, count(DISTINCT person_id) AS cnt "
            "FROM events "
            "WHERE event = 'page_view' "
            "AND timestamp >= now() - INTERVAL 14 DAY "
            "AND (properties.internal_user IS NULL OR properties.internal_user != true) "
            "GROUP BY day "
            "ORDER BY day ASC"
        )
        daily = [
            {"date": str(row[0]), "visitors": row[1]}
            for row in (daily_res.get("results") or [])
        ]

        return jsonify({
            "unique_visitors_30d": visitors,
            "total_views_30d": total_views,
            "views_today": views_today,
            "top_routes": routes,
            "daily_visitors": daily,
        })

    except Exception as e:
        logger.error("PostHog stats error: %s", e)
        return jsonify({"error": str(e)}), 500


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
            FROM ingestion_runs
            ORDER BY started_at DESC
            LIMIT 20
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

        return jsonify({
            "total_listings": total,
            "by_source_status": status_counts,
            "by_locality": locality_counts,
            "recent_runs": recent_runs,
        })

    except Exception as e:
        logger.error("pipeline-status error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        _put_conn(conn)


if __name__ == "__main__":
    port  = int(os.environ.get("PORT", 5001))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(debug=debug, host="0.0.0.0", port=port)
