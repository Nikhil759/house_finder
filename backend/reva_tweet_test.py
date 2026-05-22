"""Dry-run Reva tweet generation without posting to Twitter."""

import os

import psycopg2
from dotenv import load_dotenv

from reva_tweet_common import (
    fetch_curated_posts,
    fetch_last_tweets,
    generate_tweet_with_retry,
    pick_diverse_posts,
    pick_mode,
    pick_post_for_mode,
    MODE_LABELS,
)

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))


def main():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set in .env")
        return

    if not os.getenv("GEMINI_API_KEY"):
        print("ERROR: GEMINI_API_KEY not set in .env")
        return

    print("Connecting to database...")
    try:
        conn = psycopg2.connect(db_url)
    except Exception as e:
        print(f"ERROR: Could not connect to database: {e}")
        return

    print("Fetching curated posts...")
    try:
        posts = fetch_curated_posts(conn)
        last_tweets = fetch_last_tweets(conn)
    except Exception as e:
        print(f"ERROR: Could not fetch posts: {e}")
        conn.close()
        return
    conn.close()

    if not posts:
        print("ERROR: No curated posts found. Run ingestion and tagging first.")
        return

    print(f"Found {len(posts)} curated posts. Picking 10 diverse ones...\n")
    selected = pick_diverse_posts(posts, n=10)

    generated = []
    used_feed_ids = set()

    print("=" * 60)
    print("REVA TWEET TEST — 10 Generated Tweets (dry run)")
    print("=" * 60)

    for i in range(10):
        mode = pick_mode()
        post = pick_post_for_mode(selected, mode, used_feed_ids)
        if post and post.get("feed_id"):
            used_feed_ids.add(post["feed_id"])

        if not post:
            print(f"\n[{i + 1}/10] ERROR: No post available")
            continue

        print(f"\n[{i + 1}/10] {post['locality']} — {post['canonical_topic'].replace('_', ' ')}")
        print(f"Mode: {mode} ({MODE_LABELS[mode]})")
        print(f"Sentiment: {post.get('sentiment', 'unknown')} | Source: {post.get('source', '?')}")
        if post.get("is_trending"):
            print("** TRENDING **")
        print("-" * 40)

        try:
            anti_rep = last_tweets + [t["text"] for t in generated]
            tweet, style = generate_tweet_with_retry(post, mode, anti_rep)
            char_count = len(tweet)
            flags = []
            if char_count > 240:
                flags.append("OVER 240")
            if char_count > 280:
                flags.append("OVER 280")
            flag_str = f"  *** {' / '.join(flags)} ***" if flags else ""

            print(f"Style: {style[:80]}...")
            print(tweet)
            print(f"[{char_count} chars{flag_str}]")
            generated.append({"text": tweet, "mode": mode, "post": post})
        except Exception as e:
            print(f"ERROR generating tweet: {e}")

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    mode_counts = {}
    for item in generated:
        mode_counts[item["mode"]] = mode_counts.get(item["mode"], 0) + 1
    for mode, count in sorted(mode_counts.items()):
        print(f"  {mode}: {count}")
    print(f"\nTotal generated: {len(generated)}/10")
    print("Done. No tweets were posted.")


if __name__ == "__main__":
    main()
