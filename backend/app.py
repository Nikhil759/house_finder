from flask import Flask, jsonify, request
from flask_cors import CORS
import requests as http
import re
import time
import sqlite3
import json
import os
import asyncio
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

app = Flask(__name__)
CORS(app)

HEADERS = {"User-Agent": "housing-finder/1.0"}

# ─────────────────────────────────────────────
# Bangalore subreddits — fixed
# ─────────────────────────────────────────────
SUBREDDITS = ["bangalore", "bengaluru", "indianrealestate", "bangalorerentals", "FlatandFlatmatesBLR", "FlatmatesinBangalore"]
SEARCH_URL  = "https://www.reddit.com/r/" + "+".join(SUBREDDITS) + "/search.json"

BANGALORE_AREAS = [
    "indiranagar", "whitefield", "koramangala", "hsr layout", "hsr",
    "bellandur", "marathahalli", "sarjapur", "btm layout", "btm",
    "jayanagar", "hebbal", "yelahanka", "electronic city", "bannerghatta",
    "cunningham", "mg road", "frazer town", "banaswadi", "hoodi",
    "kr puram", "domlur", "madiwala", "bommanahalli", "brookefield",
    "kadubeesanahalli", "panathur", "varthur", "thubarahalli", "kadugodi",
    "jp nagar", "banashankari", "rajajinagar", "malleshwaram", "yeshwanthpur",
    "nagawara", "hbr layout", "cv raman nagar", "old airport road",
]

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
                    first_line = text.split("\n")[0][:120]
                    group_posts.append({
                        "id": str(msg.id),
                        "source": "telegram",
                        "title": first_line,
                        "body": text[:500],
                        "author": str(msg.sender_id or ""),
                        "url": f"https://t.me/{group}/{msg.id}",
                        "group": f"t.me/{group}",
                        "score": 0,
                        "comments": 0,
                        "created": int(msg.date.timestamp()),
                        "flair": "",
                        "price": extract_price(text),
                        "contact": extract_contact(text),
                    })
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
# Quality scoring
# ─────────────────────────────────────────────
_SCORE_LOCALITIES = [
    "indiranagar", "whitefield", "koramangala", "hsr", "bellandur",
    "marathahalli", "sarjapur", "btm", "jayanagar", "hebbal",
    "electronic city", "bannerghatta", "mg road", "frazer town",
    "hoodi", "kr puram", "domlur", "madiwala", "yelahanka",
    "cunningham", "banaswadi", "jp nagar", "rajajinagar", "malleswaram",
    "yeshwanthpur", "panathur", "varthur", "brookefield", "itpl",
    "manyata", "thanisandra", "hennur", "kalyan nagar", "rt nagar",
]
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
            self._conn = psycopg2.connect(url)
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


def fetch_listings(area="", bhk="any", budget="", keywords="", limit=30):
    """Shared fetch logic used by /api/search and alert checker."""
    query  = build_query(area, bhk, budget, keywords)
    params = {"q": query, "sort": "new", "limit": limit, "t": "month", "restrict_sr": "1"}
    try:
        resp = http.get(SEARCH_URL, headers=HEADERS, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        return [], query, str(e)

    posts = []
    for item in data.get("data", {}).get("children", []):
        p    = item.get("data", {})
        text = p.get("title", "") + " " + p.get("selftext", "")
        post = {
            "id":        p.get("id"),
            "source":    "reddit",
            "title":     p.get("title", ""),
            "subreddit": p.get("subreddit", ""),
            "author":    p.get("author", "[deleted]"),
            "url":       f"https://reddit.com{p.get('permalink', '')}",
            "selftext":  p.get("selftext", "")[:500],
            "score":     p.get("score", 0),
            "comments":  p.get("num_comments", 0),
            "created":   p.get("created_utc", 0),
            "flair":     p.get("link_flair_text") or "",
            "price":     extract_price(text),
            "contact":   extract_contact(text),
        }
        post["quality_score"] = quality_score(post)
        posts.append(post)

    posts = [p for p in posts if is_listing(p)]
    return posts, query, None


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
      You're receiving this because you set up a housing alert on Reddit Housing Scanner.<br>
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
    area      = request.args.get("area", "").strip()
    bhk       = request.args.get("bhk", "any").strip()
    budget    = request.args.get("budget", "").strip()
    keywords  = request.args.get("keywords", "").strip()
    limit     = min(int(request.args.get("limit", 50)), 50)
    sort      = request.args.get("sort", "score")
    min_score = max(0, min(60, int(request.args.get("min_score", 20))))
    sources_param = request.args.get("sources", "reddit")
    source_list   = [s.strip() for s in sources_param.split(",") if s.strip()]

    all_posts = []
    query     = None
    err       = None

    if "reddit" in source_list:
        reddit_posts, query, err = fetch_listings(area, bhk, budget, keywords, limit)
        if err:
            return jsonify({"error": err}), 500
        all_posts += reddit_posts

    if "telegram" in source_list:
        all_posts += fetch_telegram(bhk, keywords, limit)

    # Score every post
    for post in all_posts:
        post["quality_score"] = score_post(post)

    # Filter out low-quality posts
    all_posts = [p for p in all_posts if p["quality_score"] >= min_score]

    # Sort
    if sort == "newest":
        all_posts.sort(key=lambda x: x["created"], reverse=True)
    elif sort == "upvotes":
        all_posts.sort(key=lambda x: x.get("score", 0), reverse=True)
    else:
        all_posts.sort(key=lambda x: x["quality_score"], reverse=True)

    return jsonify({
        "posts":      all_posts,
        "total":      len(all_posts),
        "query":      query or "",
        "subreddits": SUBREDDITS,
    })


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


if __name__ == "__main__":
    port  = int(os.environ.get("PORT", 5001))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(debug=debug, host="0.0.0.0", port=port)
