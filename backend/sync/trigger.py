"""
Sync trigger helper — fire-and-forget POST to refresh the SQLite replica.

Used by scrapers and transforms to trigger a sync after successful DB writes.
Also used by the scheduled safety-net cron service.
"""

import logging
import os

import requests

logger = logging.getLogger(__name__)


def trigger_sync_after_completion(reason: str = "scraper_completed") -> None:
    """
    Fire-and-forget POST to /api/admin/trigger-sync.
    Used by scrapers/transforms to refresh the SQLite replica after writes.
    Never raises — logs errors and returns. The scraper's exit status must
    never depend on sync success.
    """
    url = os.environ.get("SYNC_TRIGGER_URL", "")
    secret = os.environ.get("SYNC_TRIGGER_SECRET", "")

    if not url or not secret:
        logger.warning(
            "sync_trigger_skipped: SYNC_TRIGGER_URL or SYNC_TRIGGER_SECRET not set",
            extra={"reason": reason},
        )
        return

    try:
        resp = requests.post(
            url,
            headers={"X-Sync-Secret": secret},
            params={"trigger_reason": reason},
            timeout=30,
        )
        if resp.status_code == 200:
            logger.info("sync_triggered", extra={"reason": reason, "status": 200})
        else:
            logger.warning(
                "sync_trigger_non_200",
                extra={"reason": reason, "status": resp.status_code, "body": resp.text[:200]},
            )
    except Exception as e:
        logger.warning(
            "sync_trigger_failed",
            extra={"reason": reason, "error": str(e)},
        )
