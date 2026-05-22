"""
Reva Pulse Tweet — posts one tweet per cron run.

Cron schedule (Railway):
  Morning : 30 3 * * *   →  9:00 AM IST
  Evening : 30 15 * * *  →  9:00 PM IST

SQL — run once in Supabase before first use:
  See migrations/019_reva_log_coverage.sql
"""

import os

import psycopg2
import tweepy
from dotenv import load_dotenv

from reva_tweet_common import (
    fetch_best_post,
    fetch_last_tweets,
    fetch_recent_coverage,
    generate_tweet_with_retry,
    log_tweet,
    pick_mode,
    MODE_LABELS,
)

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))


def get_db_connection():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL not set in .env")
    return psycopg2.connect(db_url)


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

    mode = pick_mode()
    exclude_feed_ids, exclude_pairs = fetch_recent_coverage(conn)
    prefer_sentiment = "positive" if mode == "positive" else None

    print(f"Mode: {mode} ({MODE_LABELS[mode]})")
    print(f"Excluding {len(exclude_feed_ids)} feed_ids, {len(exclude_pairs)} locality+topic pairs")

    print("Fetching best curated post...")
    try:
        post = fetch_best_post(
            conn,
            prefer_sentiment=prefer_sentiment,
            exclude_feed_ids=exclude_feed_ids,
            exclude_pairs=exclude_pairs,
        )
    except Exception as e:
        print(f"ERROR: Could not fetch post: {e}")
        conn.close()
        return

    if not post:
        print("ERROR: No curated posts found. Run ingestion and tagging first.")
        conn.close()
        return

    last_tweets = fetch_last_tweets(conn)

    print(f"\nFeed ID  : {post.get('feed_id')}")
    print(f"Locality : {post['locality']}")
    print(f"Topic    : {post['canonical_topic'].replace('_', ' ')}")
    print(f"Sentiment: {post.get('sentiment', 'unknown')}")
    print(f"Trending : {bool(post.get('is_trending'))}")
    print(f"Last tweets fetched for anti-repetition: {len(last_tweets)}")

    print("\nGenerating tweet...")
    try:
        tweet_text, style_modifier = generate_tweet_with_retry(post, mode, last_tweets)
    except Exception as e:
        print(f"ERROR: Gemini generation failed: {e}")
        conn.close()
        return

    char_count = len(tweet_text)
    print(f"Style: {style_modifier[:80]}...")
    print(f"\nGenerated tweet ({char_count} chars):")
    print(f"  {tweet_text}")

    if char_count > 280:
        print("ERROR: Tweet exceeds 280 characters. Aborting.")
        conn.close()
        return

    if char_count > 240:
        print("Warning: Tweet exceeds 240-char target but is within Twitter limit.")

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
        log_tweet(conn, tweet_text, tweet_id, mode, post)
        print("Logged.")
    except Exception as e:
        print(f"Warning: tweet posted but failed to log: {e}")

    conn.close()


if __name__ == "__main__":
    main()
