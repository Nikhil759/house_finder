#!/usr/bin/env python3
"""
audit_housing_payload.py — Inspect raw_payload structure for housing.com listings.

Usage:
    python3 scripts/audit_housing_payload.py

Connects via SUPABASE_DB_URL / DATABASE_URL in backend/.env and prints:
  • Full raw_payload keys + sample values for 3 housing rows
  • Focused spotlight on: photos/images, society/building, lat/long, address fields
"""

import json
import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    print("ERROR: python-dotenv is not installed. Run: pip install python-dotenv")
    sys.exit(1)

env_path = Path(__file__).resolve().parent.parent / "backend" / ".env"
load_dotenv(env_path if env_path.exists() else None)

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


# ── Fetch sample rows ──────────────────────────────────────────────────────────
cur.execute("SELECT COUNT(*) FROM listings WHERE source = 'housing';")
total: int = cur.fetchone()[0]

cur.execute(
    """
    SELECT source_id, title, locality, latitude, longitude,
           thumbnail_url, address, raw_payload
    FROM   listings
    WHERE  source = 'housing'
      AND  raw_payload IS NOT NULL
    LIMIT  3;
    """
)
rows = cur.fetchall()
conn.close()


# ── Helpers ────────────────────────────────────────────────────────────────────
WIDTH = 56

def section(title: str) -> None:
    print()
    print("─" * WIDTH)
    print(f"  {title}")
    print("─" * WIDTH)

def preview(val, width: int = 70) -> str:
    s = repr(val)
    return s[:width - 3] + "..." if len(s) > width else s

def dig(payload: dict, *keys):
    """Safely traverse nested dicts."""
    node = payload
    for k in keys:
        if not isinstance(node, dict):
            return None
        node = node.get(k)
    return node


# ── Header ─────────────────────────────────────────────────────────────────────
section("HOUSING.COM RAW PAYLOAD AUDIT")
print(f"  Total housing rows in DB : {total:,}")
print(f"  Rows sampled             : {len(rows)}")

# ── Per-row detail ─────────────────────────────────────────────────────────────
for idx, (source_id, title, locality, lat, lng, thumb, address, raw) in enumerate(rows, start=1):
    if isinstance(raw, str):
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            print(f"\n  Row {idx}: <invalid JSON in raw_payload>")
            continue
    elif isinstance(raw, dict):
        payload = raw
    else:
        print(f"\n  Row {idx}: <unexpected type {type(raw).__name__}>")
        continue

    section(f"ROW {idx}  —  {source_id}")
    print(f"  Stored title    : {title}")
    print(f"  Stored locality : {locality}")
    print(f"  Stored address  : {address}")
    print(f"  Stored lat/lng  : {lat}, {lng}")
    print(f"  Stored thumb    : {thumb}")

    # ── All keys ───────────────────────────────────────────────────────────────
    print()
    print(f"  All raw_payload keys ({len(payload)}):")
    for k, v in payload.items():
        print(f"    • {k:<28}  {preview(v)}")

    # ── Spotlight: address fields ──────────────────────────────────────────────
    print()
    print("  [ Address fields ]")
    addr_obj = payload.get("address") or {}
    if isinstance(addr_obj, dict):
        for sub_key in ("subAddress", "address", "longAddress", "city"):
            val = addr_obj.get(sub_key)
            if val is not None:
                print(f"    address.{sub_key:<22} {preview(val)}")
    elif addr_obj:
        print(f"    address (raw) : {preview(addr_obj)}")
    else:
        print("    address       : <not present>")

    # ── Spotlight: lat / long ──────────────────────────────────────────────────
    print()
    print("  [ Location / coordinates ]")
    loc = payload.get("location")
    street = payload.get("streetInfo")
    print(f"    location      : {preview(loc) if loc is not None else '<not present>'}")
    print(f"    streetInfo    : {preview(street) if street is not None else '<not present>'}")

    # ── Spotlight: photos / images ─────────────────────────────────────────────
    print()
    print("  [ Photos / images ]")
    cover = payload.get("coverImage")
    if isinstance(cover, dict):
        print(f"    coverImage.url: {preview(cover.get('url', '<no url key>'))}")
    elif cover:
        print(f"    coverImage    : {preview(cover)}")
    else:
        print("    coverImage    : <not present>")

    photos = payload.get("photos") or payload.get("images") or payload.get("gallery")
    if photos:
        count = len(photos) if isinstance(photos, list) else "?"
        sample = photos[0] if isinstance(photos, list) and photos else photos
        print(f"    photos/images : {count} items  — first: {preview(sample)}")
    else:
        print("    photos/images : <not present in payload>")

    # ── Spotlight: society / building name ─────────────────────────────────────
    print()
    print("  [ Society / building name ]")
    candidates = {
        "subtitle":     payload.get("subtitle"),
        "label":        payload.get("label"),
        "society":      payload.get("society") or payload.get("societyName"),
        "buildingName": payload.get("buildingName") or payload.get("building"),
        "project":      payload.get("project") or payload.get("projectName"),
    }
    found_any = False
    for field, val in candidates.items():
        if val:
            print(f"    {field:<26}  {preview(val)}")
            found_any = True
    if not found_any:
        print("    <none of subtitle/label/society/building/project found>")

print()
print("─" * WIDTH)
print("  Done.")
print()
