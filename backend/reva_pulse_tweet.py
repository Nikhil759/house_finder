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
    compose_tweet_with_link,
    estimated_tweet_length,
    fetch_best_post,
    fetch_last_tweets,
    fetch_recent_coverage,
    generate_tweet_with_retry,
    log_tweet,
    pick_mode,
    MODE_LABELS,
    TWEET_BODY_MAX_WITH_LINK,
    TWITTER_MAX_CHARS,
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

    print(f"Mode: {mode} ({MODE_LABELS[mode]})")
    print(f"Excluding {len(exclude_feed_ids)} feed_ids, {len(exclude_pairs)} locality+topic pairs")

    print("Fetching best curated post...")
    try:
        post = fetch_best_post(
            conn,
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

    try:
        final_text, link, link_type = compose_tweet_with_link(
            tweet_text, post, last_tweets
        )
    except Exception as e:
        print(f"ERROR: Could not compose tweet with link: {e}")
        conn.close()
        return

    body_count = len(tweet_text)
    char_count = estimated_tweet_length(final_text)
    print(f"Style: {style_modifier[:80]}...")
    print(f"Link ({link_type}): {link}")
    print(f"\nGenerated tweet (body {body_count} chars, ~{char_count} weighted):")
    print(f"  {final_text}")

    if char_count > TWITTER_MAX_CHARS:
        print("ERROR: Tweet exceeds 280 characters. Aborting.")
        conn.close()
        return

    if body_count > TWEET_BODY_MAX_WITH_LINK:
        print("Warning: Tweet body exceeds 215-char target but is within Twitter limit.")

    print("\nPosting tweet...")
    try:
        tweet_id = post_tweet(final_text)
        print(f"Posted! Tweet ID: {tweet_id}")
    except Exception as e:
        print(f"ERROR: Could not post tweet: {e}")
        conn.close()
        return

    print("Logging to reva_log...")
    try:
        log_tweet(conn, final_text, tweet_id, mode, post)
        print("Logged.")
    except Exception as e:
        print(f"Warning: tweet posted but failed to log: {e}")

    conn.close()


if __name__ == "__main__":
    main()
