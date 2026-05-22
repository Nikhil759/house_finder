"""Shared Reva tweet generation logic."""

import os
import random
import re

import google.generativeai as genai

LITERARY_MODE_CHANCE = 0.25
POSITIVE_MODE_CHANCE = 0.30

RECENT_TWEET_LIMIT = 12
MAX_GENERATION_ATTEMPTS = 3
COVERAGE_LOOKBACK_DAYS = 7

NEGATIVE_STYLE_MODIFIERS = [
    "Write this as a dry observation, like you just noticed something no one else was saying out loud.",
    "Write this like you're gently roasting Bangalore's rental market — fondly, not furiously.",
    "Find the absurd detail in this and make that the whole tweet. Deadpan delivery.",
    "Write this like someone who has accepted the chaos and found it kind of funny.",
    "The vibe is: you've cracked the code on something renters haven't admitted to themselves yet.",
    "Write this like a plot twist reveal — the data is the punchline.",
    "Dry humor. The kind where you smile before you realize it's also kind of sad.",
    "Write this like you're texting a friend who is about to make a mistake renting in this area.",
    "Open with a specific detail, not a general statement.",
    "The tone is: amused, not annoyed.",
]

POSITIVE_STYLE_MODIFIERS = [
    "Quietly pleased. Something actually went right for renters — note it without turning into a celebration post.",
    "Understated good news. The vibe is a small nod, not a parade.",
    "Playful but dry. Like you're mildly smug that renters caught a break for once.",
    "Warm group-chat energy. Share the win like you'd text a friend, not like you're posting a testimonial.",
    "Find the one detail that makes this good news feel real and specific — not generic optimism.",
    "Light and witty. Good news without sounding like you're selling hope.",
    "The tone is: pleasantly surprised Bangalore didn't disappoint for once.",
    "Cheerful without cheerleading. Grounded in the data, not vibes alone.",
]

LITERARY_STYLE_MODIFIERS = [
    "Write in the spirit of Dostoevsky: one simple sentence about guilt or compromise in renting. Plain words, heavy feeling. No philosophy lecture.",
    "Write in the spirit of Kafka: describe the rental process like a ridiculous rule everyone follows. Simple, deadpan, immediately clear.",
    "Write in the spirit of Hemingway: short sentences. Everyday words. Say exactly what happened.",
    "Write in the spirit of Chekhov: quiet melancholy about ordinary life. Something small and sad and true about renting here.",
    "Write in the spirit of Vonnegut: darkly funny, humane, slightly cosmic. So it goes. Renting here is ridiculous and you notice.",
    "Write in the spirit of Wilde: one witty line anyone gets. Clever, not clever-clever.",
    "Write in the spirit of Gogol: the rental market as slightly grotesque comedy. Uncomfortable and funny, but easy to follow.",
    "Write in the spirit of Murakami: something mundane about this listing becomes quietly strange. Lonely, specific detail, simple words.",
    "Write in the spirit of R.K. Narayan: gentle, observational, human. Small-town wisdom applied to big-city renting.",
    "Write in the spirit of Orwell: plain English, moral clarity, controlled anger. No ornament. Say what is actually happening to renters.",
]

MODE_LABELS = {
    "default": "Pulse Drop",
    "positive": "Pulse Drop — Good News",
    "literary": "Pulse Drop — Literary",
}

MODE_STYLE_POOLS = {
    "default": NEGATIVE_STYLE_MODIFIERS,
    "positive": POSITIVE_STYLE_MODIFIERS,
    "literary": LITERARY_STYLE_MODIFIERS,
}

MODE_LOG_NAMES = {
    "default": "pulse_drop",
    "positive": "pulse_drop_positive",
    "literary": "pulse_drop_literary",
}

SYSTEM_PROMPT = """
You are Reva — the voice of NestIQ on Twitter.
NestIQ is a rental intelligence platform for Bangalore.
You are not a brand account. You are a sharp, slightly sardonic
Bangalorean who knows the rental market deeply and is always on
the renter's side.

Your voice:
- Smart but never smug
- Dry wit, not slapstick
- Opinionated but grounded in real data
- Warm underneath the sarcasm
- You speak like a friend who lives in Bangalore, not a startup
- When the signal is good news, be quietly cheerful — pleased, not hypey
- In literary mode, prioritize voice and rhythm — still plain and readable

Accessibility:
- Write for a smart person scrolling Twitter — not a literature seminar
- Plain words. If a simpler word works, use it
- One clear idea. No nested clauses, no riddles, no metaphors that need explaining
- Someone who knows nothing about the author should still instantly get the tweet
- Locality names are fine. Avoid jargon only longtime renters would know

Hard rules:
- Max 240 characters
- No hashtags
- No em dashes
- No corporate phrases
- Never explain the joke
- Never start with "I"
- One idea per tweet. Never two.
"""

TASK_BY_MODE = {
    "default": (
        "Task: Write a tweet grounded in this signal. Find the tension, the irony, "
        "or the truth that most people feel but haven't said. There must be a point "
        "of view — not just a stat."
    ),
    "positive": (
        "Task: Write a tweet about something genuinely good or hopeful for renters in "
        "this signal. Be cheerful and playful, but understated — no exclamation marks, "
        "no hype words (amazing, incredible, game-changer), no fanboying of platforms "
        "or brokers. Name the specific win. Still sharp and specific, not saccharine."
    ),
    "literary": (
        "Task: Write a tweet grounded in this rental signal, in the literary voice "
        "described below. Capture rhythm and worldview — not vocabulary, not parody, "
        "do not name the author. No archaic English. No abstract philosophy. "
        "If a friend who hasn't read the author wouldn't get it in one glance, simplify. "
        "Still specific to this locality and topic."
    ),
}

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
    roll = random.random()
    if roll < LITERARY_MODE_CHANCE:
        return "literary"
    if roll < LITERARY_MODE_CHANCE + POSITIVE_MODE_CHANCE:
        return "positive"
    return "default"


def pick_style_modifier(mode, exclude=None):
    pool = [s for s in MODE_STYLE_POOLS[mode] if s != exclude]
    if not pool:
        pool = MODE_STYLE_POOLS[mode]
    return random.choice(pool)


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
            MODE_LOG_NAMES[mode],
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

    cand_opener = opening_words(candidate)
    cand_words = content_word_set(candidate)

    for prev in recent_tweets:
        if opening_words(prev) == cand_opener and cand_opener:
            return True
        prev_words = content_word_set(prev)
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

{TASK_BY_MODE[mode]}

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
    style_modifier = pick_style_modifier(mode)
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
            used_style = pick_style_modifier(mode, exclude=used_style)

        tweet_text = generate_tweet_text(
            post,
            used_style,
            mode,
            last_tweets,
            retry_note,
        )
        if len(tweet_text) <= 240 and not is_too_similar(tweet_text, last_tweets or []):
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


def pick_post_for_mode(posts, mode, used_feed_ids=None):
    used_feed_ids = used_feed_ids or set()

    if mode == "positive":
        positive = [
            p for p in posts
            if (p.get("sentiment_score") or 0) > 0.2 or p.get("sentiment") == "positive"
        ]
        for pool in (positive, posts):
            for post in pool:
                if post.get("feed_id") not in used_feed_ids:
                    return post

    for post in posts:
        if post.get("feed_id") not in used_feed_ids:
            return post
    return posts[0] if posts else None
