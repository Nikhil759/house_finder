"""Shared Reva tweet generation logic."""

from __future__ import annotations

import os
import random
import re

import google.generativeai as genai

RECENT_TWEET_LIMIT = 12
MAX_GENERATION_ATTEMPTS = 3
COVERAGE_LOOKBACK_DAYS = 7
SOURCE_LINK_CHANCE = 0.5
TWEET_BODY_MAX_WITH_LINK = 215
TWITTER_MAX_CHARS = 280
TCO_URL_LENGTH = 23


def _app_url() -> str:
    return os.getenv("APP_URL", "https://nestiq.homes").rstrip("/")

LITERARY_STYLE_MODIFIERS = [
    "Write in the spirit of Dostoevsky: one plain sentence about guilt or compromise in renting. Heavy feeling, simple words. No philosophy lecture.",
    "Write in the spirit of Orwell: plain English, moral clarity, controlled anger. Say exactly what is happening to renters. No ornament.",
    "Write in the spirit of R.K. Narayan: gentle, observational, human. Small-town wisdom applied to Bangalore renting. Warm, not sentimental.",
    "Write in the spirit of Satyajit Ray: humanist and cinematic. One quiet moment that reveals character. Dignity in ordinary struggle.",
    "Write in the spirit of Ruskin Bond: deceptively simple. One small detail, warm melancholy. Like a note from a window overlooking the city.",
    "Write in the spirit of Kafka: the rental process as a ridiculous rule everyone follows. Deadpan, immediately clear, slightly absurd.",
    "Write in the spirit of Chekhov: quiet melancholy about ordinary life. Something small and sad and true about renting here.",
    "Write in the spirit of Manto: unflinching slice of life. No sentimentality. Say what actually happened, plainly.",
    "Write in the spirit of Murakami: something mundane about this listing becomes quietly strange. Lonely, specific detail, simple words.",
    "Write in the spirit of Vonnegut: darkly funny, humane, slightly cosmic. Renting here is ridiculous and you notice.",
]

LITERARY_POSITIVE_STYLE_MODIFIERS = [
    "Write in the spirit of R.K. Narayan: gentle, observational, human. Small-town wisdom applied to Bangalore renting. Warm, not sentimental.",
    "Write in the spirit of Satyajit Ray: humanist and cinematic. One quiet moment that reveals character. Dignity in ordinary struggle.",
    "Write in the spirit of Ruskin Bond: deceptively simple. One small detail, warm melancholy. Like a note from a window overlooking the city.",
    "Write in the spirit of Chekhov: quiet tenderness about ordinary life. Something small and true that went right for once.",
    "Write in the spirit of Vonnegut: darkly funny, humane, slightly cosmic. A small mercy in a ridiculous rental market.",
]

LITERARY_SENTIMENT_HINTS = {
    "positive": (
        "This signal is genuinely good for renters. Express quiet relief or understated hope — "
        "no hype, no exclamation marks, no words like amazing or incredible. Name one specific win."
    ),
    "negative": (
        "This signal is hard for renters. Let the literary voice carry weight, irony, or melancholy."
    ),
    "neutral": (
        "Find the human truth in this signal. Observational and specific."
    ),
}

MODE = "literary"

MODE_LABELS = {
    "literary": "Pulse Drop — Literary",
}

SYSTEM_PROMPT = """
You are Reva — the voice of NestIQ on Twitter.
NestIQ is a rental intelligence platform for Bangalore.
You are not a brand account. You are a sharp, slightly sardonic
Bangalorean who knows the rental market deeply and is always on
the renter's side.

Your voice:
- Literary in rhythm and worldview — always in the spirit of a great author, never parody
- Smart but never smug
- Dry wit when the signal is hard; quiet warmth when the signal is good
- Opinionated but grounded in real data
- You speak like a friend who lives in Bangalore, not a startup
- When the signal is good news, be quietly pleased — understated, not hypey

Accessibility:
- Write for a smart person scrolling Twitter — not a literature seminar
- Plain words. If a simpler word works, use it
- One clear idea. No nested clauses, no riddles, no metaphors that need explaining
- Someone who knows nothing about the author should still instantly get the tweet
- Locality names are fine. Avoid jargon only longtime renters would know

Hard rules:
- Max 215 characters (a link is appended after your text)
- No hashtags
- No em dashes
- No corporate phrases
- Never explain the joke
- Never start with "I"
- One idea per tweet. Never two.
- Do not name the author in the tweet
"""

TASK_LITERARY = (
    "Task: Write a tweet grounded in this rental signal, in the literary voice "
    "described below. Capture rhythm and worldview — not vocabulary, not parody. "
    "No archaic English. No abstract philosophy. "
    "If a friend who hasn't read the author wouldn't get it in one glance, simplify. "
    "Still specific to this locality and topic."
)

_POST_SELECT = """
    SELECT
        lf.id AS feed_id,
        lf.locality,
        lf.canonical_topic,
        lf.sentiment_score,
        lf.sentiment,
        lf.title,
        lf.body,
        lf.source,
        lf.url,
        fc.is_trending,
        fc.editor_rank,
        fc.editor_note
    FROM feed_curated fc
    JOIN locality_feed lf ON lf.id = fc.feed_id
    WHERE lf.scraped_at > NOW() - INTERVAL '{hours} hours'
      AND lf.locality IS NOT NULL
      AND lf.canonical_topic IS NOT NULL
      AND lf.category IN ('discussion', 'news')
      {sentiment_filter}
      {exclusion_filter}
    ORDER BY
        fc.is_trending DESC NULLS LAST,
        fc.editor_rank ASC NULLS LAST,
        lf.relevance_score DESC
    LIMIT 1
"""

_CURATED_LIST_SELECT = """
    SELECT
        lf.id AS feed_id,
        lf.locality,
        lf.canonical_topic,
        lf.sentiment_score,
        lf.sentiment,
        lf.title,
        lf.body,
        lf.source,
        lf.url,
        fc.is_trending,
        fc.editor_rank,
        fc.editor_note
    FROM feed_curated fc
    JOIN locality_feed lf ON lf.id = fc.feed_id
    WHERE lf.scraped_at > NOW() - INTERVAL '{hours} hours'
      AND lf.locality IS NOT NULL
      AND lf.canonical_topic IS NOT NULL
      AND lf.category IN ('discussion', 'news')
    ORDER BY
        fc.is_trending DESC NULLS LAST,
        fc.editor_rank ASC NULLS LAST,
        lf.relevance_score DESC
    LIMIT %s
"""


def pick_mode():
    return MODE


def pick_style_modifier(post, exclude=None):
    if _sentiment_label(post) == "positive":
        pool = [s for s in LITERARY_POSITIVE_STYLE_MODIFIERS if s != exclude]
        if not pool:
            pool = LITERARY_POSITIVE_STYLE_MODIFIERS
    else:
        pool = [s for s in LITERARY_STYLE_MODIFIERS if s != exclude]
        if not pool:
            pool = LITERARY_STYLE_MODIFIERS
    return random.choice(pool)


def log_mode_name(post):
    if _sentiment_label(post) == "positive":
        return "pulse_drop_literary_positive"
    return "pulse_drop_literary"


def locality_to_slug(locality: str) -> str:
    return locality.lower().strip().replace(" ", "-")


def nestiq_locality_url(locality: str) -> str:
    return f"{_app_url()}/neighbourhood-pulse/{locality_to_slug(locality)}"


def _infer_link_type(tweet_text: str) -> str | None:
    if not tweet_text:
        return None
    base = _app_url()
    if f"{base}/neighbourhood-pulse/" in tweet_text:
        return "nestiq"
    if re.search(r"https?://", tweet_text):
        return "source"
    return None


def pick_tweet_link(post, last_tweets=None):
    """Return (url, link_type) where link_type is 'source' or 'nestiq'."""
    last_tweets = last_tweets or []
    recent_types = [_infer_link_type(t) for t in last_tweets[:3]]
    recent_types = [t for t in recent_types if t]

    prefer_source = random.random() < SOURCE_LINK_CHANCE
    if len(recent_types) >= 2 and recent_types[0] == recent_types[1]:
        prefer_source = recent_types[0] == "nestiq"

    source_url = (post.get("url") or "").strip()
    nestiq_url = nestiq_locality_url(post["locality"])

    if prefer_source and source_url:
        return source_url, "source"
    return nestiq_url, "nestiq"


def tweet_body_only(text: str) -> str:
    lines = (text or "").strip().split("\n")
    if lines and re.match(r"https?://", lines[-1].strip()):
        return "\n".join(lines[:-1]).strip()
    return (text or "").strip()


def estimated_tweet_length(text: str) -> int:
    """Approximate Twitter weighted length (URLs count as 23 chars)."""
    body = tweet_body_only(text)
    urls = re.findall(r"https?://\S+", text or "")
    link_chars = len(urls) * TCO_URL_LENGTH
    if body and urls:
        return len(body) + 1 + link_chars
    if urls and not body:
        return link_chars
    return len(body)


def compose_tweet_with_link(tweet_text: str, post, last_tweets=None):
    link, link_type = pick_tweet_link(post, last_tweets)
    final = f"{tweet_text.strip()}\n{link}"
    return final, link, link_type


def _sentiment_filter(prefer_sentiment):
    if prefer_sentiment == "positive":
        return "AND (lf.sentiment = 'positive' OR lf.sentiment_score > 0.2)"
    if prefer_sentiment == "negative":
        return "AND (lf.sentiment = 'negative' OR lf.sentiment_score < -0.2)"
    return ""


def _exclusion_filter(exclude_feed_ids, exclude_pairs):
    clauses = []
    if exclude_feed_ids:
        ids = ", ".join(str(int(i)) for i in exclude_feed_ids)
        clauses.append(f"AND lf.id NOT IN ({ids})")
    if exclude_pairs:
        pair_clauses = []
        for locality, topic in exclude_pairs:
            loc = locality.replace("'", "''")
            top = topic.replace("'", "''")
            pair_clauses.append(
                f"(lf.locality = '{loc}' AND lf.canonical_topic = '{top}')"
            )
        clauses.append(f"AND NOT ({' OR '.join(pair_clauses)})")
    return "\n      ".join(clauses)


def _row_to_post(cursor, row):
    if not row:
        return None
    columns = [d[0] for d in cursor.description]
    return dict(zip(columns, row))


def _fetch_best_post_once(cur, hours, prefer_sentiment=None, exclude_feed_ids=None, exclude_pairs=None):
    query = _POST_SELECT.format(
        hours=hours,
        sentiment_filter=_sentiment_filter(prefer_sentiment),
        exclusion_filter=_exclusion_filter(exclude_feed_ids, exclude_pairs),
    )
    cur.execute(query)
    return _row_to_post(cur, cur.fetchone())


def fetch_best_post(conn, prefer_sentiment=None, exclude_feed_ids=None, exclude_pairs=None):
    """Fetch the best curated post, relaxing exclusions if needed."""
    cur = conn.cursor()
    attempts = [
        (48, exclude_feed_ids, exclude_pairs, prefer_sentiment),
        (48, exclude_feed_ids, None, prefer_sentiment),
        (48, None, None, prefer_sentiment),
        (168, exclude_feed_ids, exclude_pairs, prefer_sentiment),
        (168, exclude_feed_ids, None, prefer_sentiment),
        (168, None, None, prefer_sentiment),
        (168, None, None, None),
    ]
    seen = set()
    for hours, feed_ids, pairs, sentiment in attempts:
        key = (hours, tuple(feed_ids or ()), tuple(pairs or ()), sentiment)
        if key in seen:
            continue
        seen.add(key)
        post = _fetch_best_post_once(cur, hours, sentiment, feed_ids, pairs)
        if post:
            return post
    return None


def fetch_curated_posts(conn, limit=30):
    cur = conn.cursor()
    for hours in (48, 168):
        cur.execute(_CURATED_LIST_SELECT.format(hours=hours), (limit,))
        columns = [d[0] for d in cur.description]
        rows = [dict(zip(columns, row)) for row in cur.fetchall()]
        if rows:
            if hours == 168:
                print("No data in last 48 hours, widening to 7 days...")
            return rows
    return []


def fetch_recent_coverage(conn, days=COVERAGE_LOOKBACK_DAYS):
    """Return feed_ids and (locality, topic) pairs recently tweeted about."""
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT feed_id, locality, canonical_topic
            FROM reva_log
            WHERE posted_at > NOW() - (%s || ' days')::interval
              AND (feed_id IS NOT NULL OR locality IS NOT NULL)
            """,
            (days,),
        )
        feed_ids = set()
        pairs = set()
        for feed_id, locality, topic in cur.fetchall():
            if feed_id is not None:
                feed_ids.add(feed_id)
            if locality and topic:
                pairs.add((locality, topic))
        return feed_ids, pairs
    except Exception as exc:
        print(f"Warning: could not fetch recent coverage from reva_log: {exc}")
        return set(), set()


def fetch_last_tweets(conn, limit=RECENT_TWEET_LIMIT):
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT tweet_text FROM reva_log
            ORDER BY posted_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        return [row[0] for row in cur.fetchall()]
    except Exception as exc:
        print(f"Warning: could not fetch reva_log history: {exc}")
        return []


def log_tweet(conn, tweet_text, tweet_id, mode, post):
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO reva_log (mode, tweet_text, tweet_id, feed_id, locality, canonical_topic)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (
            log_mode_name(post),
            tweet_text,
            str(tweet_id),
            post.get("feed_id"),
            post.get("locality"),
            post.get("canonical_topic"),
        ),
    )
    conn.commit()


def _sentiment_label(post):
    if post.get("sentiment"):
        return post["sentiment"]
    score = post.get("sentiment_score") or 0
    if score < -0.2:
        return "negative"
    if score > 0.2:
        return "positive"
    return "neutral"


def opening_words(text, n=4):
    words = re.findall(r"[A-Za-z0-9']+", (text or "").lower())
    return " ".join(words[:n])


def content_word_set(text):
    stop = {
        "a", "an", "the", "in", "on", "at", "to", "for", "of", "and", "or", "is",
        "are", "was", "were", "be", "been", "with", "that", "this", "it", "you",
        "your", "from", "as", "by", "but", "not", "no", "so", "if", "about",
    }
    words = re.findall(r"[A-Za-z0-9']+", (text or "").lower())
    return {w for w in words if w not in stop and len(w) > 2}


def is_too_similar(candidate, recent_tweets):
    if not recent_tweets:
        return False

    candidate = tweet_body_only(candidate)
    cand_opener = opening_words(candidate)
    cand_words = content_word_set(candidate)

    for prev in recent_tweets:
        prev_body = tweet_body_only(prev)
        if opening_words(prev_body) == cand_opener and cand_opener:
            return True
        prev_words = content_word_set(prev_body)
        if not cand_words or not prev_words:
            continue
        overlap = len(cand_words & prev_words) / len(cand_words | prev_words)
        if overlap > 0.55:
            return True
    return False


def build_anti_repetition_block(last_tweets, extra_note=""):
    if not last_tweets and not extra_note:
        return ""

    parts = []
    if last_tweets:
        openers = sorted({opening_words(t) for t in last_tweets if opening_words(t)})
        parts.append(
            "Do not repeat any angle, opening word, or pattern from these recent tweets:\n"
            + "\n".join(f"- {t}" for t in last_tweets)
        )
        if openers:
            parts.append(
                "Banned opening patterns (do not use these or close variants):\n"
                + "\n".join(f"- {op}" for op in openers)
            )
    if extra_note:
        parts.append(extra_note)
    return "\n\n".join(parts) + "\n"


def build_prompt(post, style_modifier, mode, last_tweets=None, retry_note=""):
    sentiment_label = _sentiment_label(post)
    sentiment_hint = LITERARY_SENTIMENT_HINTS[sentiment_label]

    context_lines = [
        f"- Locality: {post['locality']}",
        f"- Topic: {post['canonical_topic'].replace('_', ' ')}",
        f"- Sentiment: {sentiment_label} (score: {post.get('sentiment_score') or 0:.2f})",
        f"- Source: {post.get('source', 'unknown')}",
    ]
    if post.get("is_trending"):
        context_lines.append("- This topic is currently trending")
    if post.get("editor_note"):
        context_lines.append(f"- Editor note: {post['editor_note']}")

    snippet = ""
    if post.get("title"):
        snippet += f"Title: {post['title'][:200]}"
    if post.get("body"):
        snippet += f"\nExcerpt: {post['body'][:300]}"

    anti_repetition = build_anti_repetition_block(last_tweets or [], retry_note)

    return f"""Mode: {MODE_LABELS[mode]}

Data signal:
{chr(10).join(context_lines)}

What people are saying:
{snippet}

{TASK_LITERARY}

Sentiment guidance: {sentiment_hint}

Style instruction: {style_modifier}
{anti_repetition}
Output only the tweet text, nothing else."""


def _get_model():
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
    return genai.GenerativeModel(
        model_name="gemini-2.5-flash",
        system_instruction=SYSTEM_PROMPT,
    )


def generate_tweet_text(post, style_modifier, mode, last_tweets=None, retry_note=""):
    model = _get_model()
    prompt = build_prompt(post, style_modifier, mode, last_tweets, retry_note)
    response = model.generate_content(prompt)
    return response.text.strip()


def generate_tweet_with_retry(post, mode, last_tweets=None):
    style_modifier = pick_style_modifier(post)
    tweet_text = ""
    used_style = style_modifier

    for attempt in range(MAX_GENERATION_ATTEMPTS):
        retry_note = ""
        if attempt == 1:
            retry_note = (
                "Your last attempt was too similar to recent tweets or too dense. "
                "Use a completely different angle, opening, and simpler words."
            )
        elif attempt == 2:
            retry_note = (
                "Previous attempts failed checks. Write one short plain sentence. "
                "Different opening. Maximum simplicity."
            )
            used_style = pick_style_modifier(post, exclude=used_style)

        tweet_text = generate_tweet_text(
            post,
            used_style,
            mode,
            last_tweets,
            retry_note,
        )
        if (
            len(tweet_text) <= TWEET_BODY_MAX_WITH_LINK
            and not is_too_similar(tweet_text, last_tweets or [])
        ):
            return tweet_text, used_style

    return tweet_text, used_style


def pick_diverse_posts(posts, n=10):
    seen_localities = set()
    seen_topics = set()
    picked = []
    leftover = []

    for post in posts:
        loc = post["locality"]
        topic = post["canonical_topic"]
        if loc not in seen_localities or topic not in seen_topics:
            picked.append(post)
            seen_localities.add(loc)
            seen_topics.add(topic)
        else:
            leftover.append(post)
        if len(picked) >= n:
            break

    for post in leftover:
        if len(picked) >= n:
            break
        picked.append(post)

    return picked[:n]


def pick_post(posts, used_feed_ids=None):
    used_feed_ids = used_feed_ids or set()
    for post in posts:
        if post.get("feed_id") not in used_feed_ids:
            return post
    return posts[0] if posts else None


def pick_post_for_mode(posts, mode, used_feed_ids=None):
    return pick_post(posts, used_feed_ids)
