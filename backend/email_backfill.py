"""
One-time backfill: subscribe existing users and send launch announcement.

Usage:
  python email_backfill.py                  # dry run (shows what would happen)
  python email_backfill.py --send           # actually send emails
  python email_backfill.py --send --only=bn5799@gmail.com   # send to one email only (for testing)
"""

from __future__ import annotations

import argparse
import logging
import os
import time

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from email_service import send_launch_announcement, posthog_capture

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("email_backfill")


def _get_conn():
    url = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("SUPABASE_DB_URL or DATABASE_URL must be set")
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return psycopg2.connect(url)


def run(send: bool = False, only_email: str = ""):
    conn = _get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Find users who don't have an email_subscriptions row yet
        query = """
            SELECT au.id AS user_id, au.email
            FROM auth.users au
            LEFT JOIN email_subscriptions es ON es.user_id = au.id
            WHERE es.user_id IS NULL
              AND au.email IS NOT NULL
              AND au.email != ''
        """
        cur.execute(query)
        users = [dict(r) for r in cur.fetchall()]

        if only_email:
            users = [u for u in users if u["email"] == only_email]

        log.info("Found %d users to backfill%s", len(users), " (DRY RUN)" if not send else "")

        for u in users:
            log.info("  %s — %s", u["user_id"], u["email"])

        if not send:
            log.info("Pass --send to actually backfill and send emails.")
            return

        sent = 0
        errors = 0
        for u in users:
            user_id = str(u["user_id"])
            email = u["email"]

            # Insert subscription row with welcome_sent_at set to suppress regular welcome
            cur.execute("""
                INSERT INTO email_subscriptions
                    (user_id, email, new_listings_email_subscribed, new_listings_frequency,
                     welcome_sent_at, created_at, updated_at)
                VALUES (%s, %s, true, 'daily', NOW(), NOW(), NOW())
                ON CONFLICT (user_id) DO NOTHING
            """, (user_id, email))
            conn.commit()

            ok, detail = send_launch_announcement(email, user_id)
            if ok:
                sent += 1
                posthog_capture(user_id, "email_alert_sent", {"type": "launch_announcement", "email": email})
                log.info("Sent launch email to %s", email)
            else:
                errors += 1
                log.warning("Failed to send to %s: %s", email, detail)

            time.sleep(0.5)

        log.info("Backfill complete — sent=%d errors=%d", sent, errors)
    finally:
        conn.close()


def test_email(email: str):
    """Send the launch announcement to a specific email without touching the DB."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM email_subscriptions WHERE email = %s LIMIT 1", (email,))
        row = cur.fetchone()
        if not row:
            cur.execute("SELECT id FROM auth.users WHERE email = %s LIMIT 1", (email,))
            row = cur.fetchone()
        if not row:
            log.error("No user found for %s", email)
            return
        user_id = str(row[0])
        log.info("Sending test launch email to %s (user_id=%s)", email, user_id)
        ok, detail = send_launch_announcement(email, user_id)
        if ok:
            log.info("Sent successfully")
        else:
            log.warning("Failed: %s", detail)
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--send", action="store_true", help="Actually send emails (default is dry run)")
    parser.add_argument("--only", default="", help="Only send to this email address (for testing)")
    parser.add_argument("--test", default="", help="Send a test launch email to this address (no DB changes)")
    args = parser.parse_args()
    if args.test:
        test_email(args.test)
    else:
        run(send=args.send, only_email=args.only)
