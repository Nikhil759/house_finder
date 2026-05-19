"""
Scheduled sync trigger — safety net.
Runs as a separate Railway cron service every 6 hours.
Calls trigger_sync_after_completion to refresh the SQLite replica even if
scraper-triggered syncs fail or are missed.
"""
from dotenv import load_dotenv
import os
import sys

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sync.trigger import trigger_sync_after_completion

if __name__ == "__main__":
    trigger_sync_after_completion(reason="scheduled_safety_net")
