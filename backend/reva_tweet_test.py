import os
import random
import psycopg2
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


def fetch_curated_posts(conn, limit=30):
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
        LIMIT %s
    """, (limit,))
    columns = [d[0] for d in cur.description]
    rows = [dict(zip(columns, row)) for row in cur.fetchall()]

    if not rows:
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
            LIMIT %s
        """, (limit,))
        columns = [d[0] for d in cur.description]
        rows = [dict(zip(columns, row)) for row in cur.fetchall()]

    return rows


def pick_diverse_posts(posts, n=10):
    """Pick posts covering different localities and topics."""
    seen_localities = set()
    seen_topics = set()
    picked = []
    leftover = []

    for p in posts:
        loc = p["locality"]
        topic = p["canonical_topic"]
        if loc not in seen_localities or topic not in seen_topics:
            picked.append(p)
            seen_localities.add(loc)
            seen_topics.add(topic)
        else:
            leftover.append(p)
        if len(picked) >= n:
            break

    for p in leftover:
        if len(picked) >= n:
            break
        picked.append(p)

    return picked[:n]


def build_prompt(post, style_modifier):
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

    return f"""Mode: Pulse Drop

Data signal:
{chr(10).join(context_lines)}

What people are saying:
{snippet}

Task: Write a tweet grounded in this signal. Find the tension, the irony, or the truth 
that most people feel but haven't said. There must be a point of view — not just a stat.

Style instruction: {style_modifier}

Output only the tweet text, nothing else."""


def generate_tweet(model, post, style_modifier):
    prompt = build_prompt(post, style_modifier)
    response = model.generate_content(prompt)
    return response.text.strip()


def main():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set in .env")
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

    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
    model = genai.GenerativeModel(
        model_name="gemini-2.5-flash",
        system_instruction=SYSTEM_PROMPT,
    )

    styles = STYLE_MODIFIERS.copy()
    random.shuffle(styles)
    assigned_styles = [styles[i % len(styles)] for i in range(10)]

    print("=" * 60)
    print("REVA TWEET TEST — 10 Generated Tweets")
    print("=" * 60)

    for i, (post, style) in enumerate(zip(selected, assigned_styles), start=1):
        print(f"\n[{i}/10] {post['locality']} — {post['canonical_topic'].replace('_', ' ')}")
        print(f"Style: {style[:70]}...")
        print(f"Sentiment: {post.get('sentiment', 'unknown')} | Source: {post.get('source', '?')}")
        if post.get("is_trending"):
            print("** TRENDING **")
        print("-" * 40)

        try:
            tweet = generate_tweet(model, post, style)
            char_count = len(tweet)
            flag = "  *** OVER 240 ***" if char_count > 240 else ""
            print(tweet)
            print(f"[{char_count} chars{flag}]")
        except Exception as e:
            print(f"ERROR generating tweet: {e}")

    print("\n" + "=" * 60)
    print("Done. No tweets were posted.")


if __name__ == "__main__":
    main()
