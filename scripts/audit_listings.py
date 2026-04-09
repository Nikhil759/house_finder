#!/usr/bin/env python3
"""
audit_listings.py — Coverage report for the listings table.

Usage:
    python scripts/audit_listings.py

Reads SUPABASE_DB_URL (or DATABASE_URL) from backend/.env and prints:
  • Total listings count
  • Rows with latitude + longitude populated
  • Rows with thumbnail_url populated
  • Rows with address populated
  • Rows with locality populated
  • Sample raw_payload keys from 3 rows
"""

import json
import os
import sys
from pathlib import Path

# ── Load backend/.env ──────────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
except ImportError:
    print("ERROR: python-dotenv is not installed. Run: pip install python-dotenv")
    sys.exit(1)

env_path = Path(__file__).resolve().parent.parent / "backend" / ".env"
if env_path.exists():
    load_dotenv(env_path)
else:
    load_dotenv()

# ── Connect ────────────────────────────────────────────────────────────────────
try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2 is not installed. Run: pip install psycopg2-binary")
    sys.exit(1)

db_url = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL", "")
if not db_url:
    print("ERROR: SUPABASE_DB_URL / DATABASE_URL is not set.")
    sys.exit(1)

if db_url.startswith("postgres://"):
    db_url = "postgresql://" + db_url[len("postgres://"):]

try:
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
except Exception as exc:
    print(f"ERROR: Could not connect to database — {exc}")
    sys.exit(1)


# ── Helpers ────────────────────────────────────────────────────────────────────
def pct(count: int, total: int) -> str:
    if total == 0:
        return "  n/a"
    return f"{count / total * 100:5.1f}%"


def section(title: str) -> None:
    width = 52
    print()
    print("─" * width)
    print(f"  {title}")
    print("─" * width)


# ── Queries ────────────────────────────────────────────────────────────────────
cur.execute("SELECT COUNT(*) FROM listings;")
total: int = cur.fetchone()[0]

cur.execute(
    "SELECT COUNT(*) FROM listings WHERE latitude IS NOT NULL AND longitude IS NOT NULL;"
)
with_coords: int = cur.fetchone()[0]

cur.execute(
    "SELECT COUNT(*) FROM listings WHERE thumbnail_url IS NOT NULL AND thumbnail_url <> '';"
)
with_thumbnail: int = cur.fetchone()[0]

cur.execute(
    "SELECT COUNT(*) FROM listings WHERE address IS NOT NULL AND address <> '';"
)
with_address: int = cur.fetchone()[0]

cur.execute(
    "SELECT COUNT(*) FROM listings WHERE locality IS NOT NULL AND locality <> '';"
)
with_locality: int = cur.fetchone()[0]

cur.execute(
    """
    SELECT raw_payload
    FROM   listings
    WHERE  raw_payload IS NOT NULL
    LIMIT  3;
    """
)
sample_rows = cur.fetchall()

conn.close()


# ── Report ─────────────────────────────────────────────────────────────────────
section("LISTINGS TABLE — COVERAGE REPORT")

print(f"  {'Total listings':<30} {total:>8,}")

section("Field Coverage")
rows = [
    ("latitude + longitude", with_coords),
    ("thumbnail_url",        with_thumbnail),
    ("address",              with_address),
    ("locality",             with_locality),
]
for label, count in rows:
    bar = "█" * int(count / max(total, 1) * 20)
    print(f"  {label:<30} {count:>8,}  ({pct(count, total)})  {bar}")

section("Sample raw_payload Keys  (up to 3 rows)")
if not sample_rows:
    print("  No rows with raw_payload found.")
else:
    for idx, (raw,) in enumerate(sample_rows, start=1):
        if isinstance(raw, str):
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                print(f"  Row {idx}: <invalid JSON>")
                continue
        elif isinstance(raw, dict):
            payload = raw
        else:
            print(f"  Row {idx}: <unexpected type {type(raw).__name__}>")
            continue

        keys = list(payload.keys())
        print(f"\n  Row {idx}  ({len(keys)} keys):")
        for k in keys:
            val = payload[k]
            preview = repr(val)
            if len(preview) > 60:
                preview = preview[:57] + "..."
            print(f"    • {k:<28}  {preview}")

print()
print("─" * 52)
print("  Done.")
print()
