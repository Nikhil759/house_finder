"""
Reva Pulse Tweet — posts one tweet per cron run.

Cron schedule (Railway):
  Morning : 30 3 * * *   →  9:00 AM IST
  Evening : 30 13 * * *  →  7:00 PM IST

SQL — run once in Supabase before first use:
  create table if not exists reva_log (
    id serial primary key,
    mode text,
    tweet_text text,
    tweet_id text,
    posted_at timestamp default now()
  );
"""

import os
import random
import psycopg2
import tweepy
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

STYLE_MODIFIERS = [
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

Hard rules:
- Max 240 characters
- No hashtags
- No em dashes
- No corporate phrases
- Never explain the joke
- Never start with "I"
- One idea per tweet. Never two.
"""


def get_db_connection():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL not set in .env")
    return psycopg2.connect(db_url)


def fetch_best_post(conn):
    """Fetch the single best curated post from the last 48 hours (fallback: 7 days)."""
    cur = conn.cursor()
    cur.execute("""
        SELECT
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
        WHERE lf.scraped_at > NOW() - INTERVAL '48 hours'
          AND lf.locality IS NOT NULL
          AND lf.canonical_topic IS NOT NULL
          AND lf.category IN ('discussion', 'news')
        ORDER BY
            fc.is_trending DESC NULLS LAST,
            fc.editor_rank ASC NULLS LAST,
            lf.relevance_score DESC
        LIMIT 1
    """)
    row = cur.fetchone()

    if not row:
        print("No data in last 48 hours, widening to 7 days...")
        cur.execute("""
            SELECT
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
            WHERE lf.scraped_at > NOW() - INTERVAL '7 days'
              AND lf.locality IS NOT NULL
              AND lf.canonical_topic IS NOT NULL
              AND lf.category IN ('discussion', 'news')
            ORDER BY
                fc.is_trending DESC NULLS LAST,
                fc.editor_rank ASC NULLS LAST,
                lf.relevance_score DESC
            LIMIT 1
        """)
        row = cur.fetchone()

    if not row:
        return None

    columns = [d[0] for d in cur.description]
    return dict(zip(columns, row))


def fetch_last_tweets(conn, limit=5):
    """Fetch recent tweet texts from reva_log for anti-repetition."""
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT tweet_text FROM reva_log
            ORDER BY posted_at DESC
            LIMIT %s
        """, (limit,))
        return [row[0] for row in cur.fetchall()]
    except Exception as e:
        print(f"Warning: could not fetch reva_log history: {e}")
        return []


def log_tweet(conn, tweet_text, tweet_id):
    """Insert a posted tweet into reva_log."""
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO reva_log (mode, tweet_text, tweet_id)
        VALUES (%s, %s, %s)
    """, ("pulse_drop", tweet_text, str(tweet_id)))
    conn.commit()


def build_prompt(post, style_modifier, last_tweets):
    sentiment_label = post.get("sentiment") or (
        "negative" if (post.get("sentiment_score") or 0) < -0.2
        else "positive" if (post.get("sentiment_score") or 0) > 0.2
        else "neutral"
    )

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

    anti_repetition = ""
    if last_tweets:
        anti_repetition = (
            "\nDo not repeat any angle, opening word, or pattern from these recent tweets:\n"
            + "\n".join(f"- {t}" for t in last_tweets)
            + "\n"
        )

    return f"""Mode: Pulse Drop

Data signal:
{chr(10).join(context_lines)}

What people are saying:
{snippet}

Task: Write a tweet grounded in this signal. Find the tension, the irony, or the truth 
that most people feel but haven't said. There must be a point of view — not just a stat.

Style instruction: {style_modifier}
{anti_repetition}
Output only the tweet text, nothing else."""


def generate_tweet(post, style_modifier, last_tweets):
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
    model = genai.GenerativeModel(
        model_name="gemini-2.5-flash",
        system_instruction=SYSTEM_PROMPT,
    )
    prompt = build_prompt(post, style_modifier, last_tweets)
    response = model.generate_content(prompt)
    return response.text.strip()


def post_tweet(tweet_text):
    client = tweepy.Client(
        consumer_key=os.getenv("TWITTER_CONSUMER_KEY"),
        consumer_secret=os.getenv("TWITTER_CONSUMER_KEY_SECRET"),
        access_token=os.getenv("TWITTER_ACCESS_TOKEN"),
        access_token_secret=os.getenv("TWITTER_ACCESS_TOKEN_SECRET"),
    )
    response = client.create_tweet(text=tweet_text)
    return response.data["id"]


def main():
    print("Connecting to database...")
    try:
        conn = get_db_connection()
    except Exception as e:
        print(f"ERROR: {e}")
        return

    print("Fetching best curated post...")
    try:
        post = fetch_best_post(conn)
    except Exception as e:
        print(f"ERROR: Could not fetch post: {e}")
        conn.close()
        return

    if not post:
        print("ERROR: No curated posts found. Run ingestion and tagging first.")
        conn.close()
        return

    last_tweets = fetch_last_tweets(conn)

    conn_for_log = conn  # reuse connection for logging after tweet

    style_modifier = random.choice(STYLE_MODIFIERS)

    print(f"\nLocality : {post['locality']}")
    print(f"Topic    : {post['canonical_topic'].replace('_', ' ')}")
    print(f"Sentiment: {post.get('sentiment', 'unknown')}")
    print(f"Trending : {bool(post.get('is_trending'))}")
    print(f"Style    : {style_modifier[:70]}...")
    print(f"Last tweets fetched for anti-repetition: {len(last_tweets)}")

    print("\nGenerating tweet...")
    try:
        tweet_text = generate_tweet(post, style_modifier, last_tweets)
    except Exception as e:
        print(f"ERROR: Gemini generation failed: {e}")
        conn.close()
        return

    char_count = len(tweet_text)
    print(f"\nGenerated tweet ({char_count} chars):")
    print(f"  {tweet_text}")

    if char_count > 280:
        print("ERROR: Tweet exceeds 280 characters. Aborting.")
        conn.close()
        return

    print("\nPosting tweet...")
    try:
        tweet_id = post_tweet(tweet_text)
        print(f"Posted! Tweet ID: {tweet_id}")
    except Exception as e:
        print(f"ERROR: Could not post tweet: {e}")
        conn.close()
        return

    print("Logging to reva_log...")
    try:
        log_tweet(conn_for_log, tweet_text, tweet_id)
        print("Logged.")
    except Exception as e:
        print(f"Warning: tweet posted but failed to log: {e}")

    conn.close()


if __name__ == "__main__":
    main()
