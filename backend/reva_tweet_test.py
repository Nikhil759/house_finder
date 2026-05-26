"""Dry-run Reva tweet generation without posting to Twitter."""

import os

import psycopg2
from dotenv import load_dotenv

from reva_tweet_common import (
    _sentiment_label,
    compose_tweet_with_link,
    estimated_tweet_length,
    fetch_curated_posts,
    fetch_last_tweets,
    generate_tweet_with_retry,
    pick_diverse_posts,
    pick_mode,
    pick_post,
    MODE_LABELS,
    TWEET_BODY_MAX_WITH_LINK,
    TWITTER_MAX_CHARS,
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
        post = pick_post(selected, used_feed_ids)
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
            final_text, link, link_type = compose_tweet_with_link(
                tweet, post, anti_rep
            )
            body_count = len(tweet)
            char_count = estimated_tweet_length(final_text)
            flags = []
            if body_count > TWEET_BODY_MAX_WITH_LINK:
                flags.append(f"BODY OVER {TWEET_BODY_MAX_WITH_LINK}")
            if char_count > TWITTER_MAX_CHARS:
                flags.append(f"OVER {TWITTER_MAX_CHARS}")
            flag_str = f"  *** {' / '.join(flags)} ***" if flags else ""

            print(f"Style: {style[:80]}...")
            print(f"Link ({link_type}): {link}")
            print(final_text)
            print(f"[body {body_count} / ~{char_count} weighted chars{flag_str}]")
            generated.append({
                "text": final_text,
                "link_type": link_type,
                "sentiment": _sentiment_label(post),
                "post": post,
            })
        except Exception as e:
            print(f"ERROR generating tweet: {e}")

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    sentiment_counts = {}
    link_counts = {}
    for item in generated:
        sentiment_counts[item["sentiment"]] = sentiment_counts.get(item["sentiment"], 0) + 1
        link_counts[item["link_type"]] = link_counts.get(item["link_type"], 0) + 1
    for sentiment, count in sorted(sentiment_counts.items()):
        print(f"  {sentiment}: {count}")
    print("Link types:")
    for link_type, count in sorted(link_counts.items()):
        print(f"  {link_type}: {count}")
    print(f"\nTotal generated: {len(generated)}/10")
    print("Done. No tweets were posted.")


if __name__ == "__main__":
    main()
