"""
Run this ONCE locally to generate a Telegram StringSession.
The printed string is your TELEGRAM_SESSION_STRING — paste it into Railway.

Usage:
    cd backend
    source venv/bin/activate
    python generate_session.py
"""
import os
from dotenv import load_dotenv
from telethon.sync import TelegramClient
from telethon.sessions import StringSession

load_dotenv()

api_id   = int(os.environ["TELEGRAM_API_ID"])
api_hash = os.environ["TELEGRAM_API_HASH"]

with TelegramClient(StringSession(), api_id, api_hash) as client:
    session_string = client.session.save()

print("\n" + "="*60)
print("TELEGRAM_SESSION_STRING (paste this into Railway):")
print("="*60)
print(session_string)
print("="*60 + "\n")
