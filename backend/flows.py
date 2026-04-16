"""
Prefect flow wrappers for all ingestion scripts.

Each flow wraps the existing `main()` function of an ingestion script,
adding Prefect retry policies, structured logging, and schedule metadata.

Usage:
  Local testing:  python flows.py                   (runs all flows once)
  Single flow:    python -c "from flows import ingest_nobroker; ingest_nobroker()"
  Deploy all:     prefect deploy --all              (reads prefect.yaml)
"""

from __future__ import annotations

import logging
from prefect import flow
from prefect.logging import get_run_logger

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


# ─────────────────────────────────────────────
# Listings Ingestion Flows (4)
# ─────────────────────────────────────────────

@flow(
    name="ingest-nobroker",
    retries=2,
    retry_delay_seconds=60,
    timeout_seconds=600,
    log_prints=True,
)
def ingest_nobroker():
    """NoBroker listings — every 3 hours."""
    logger = get_run_logger()
    logger.info("Starting NoBroker ingestion flow")
    from ingestion.ingest_nobroker import main
    main()
    logger.info("NoBroker ingestion flow complete")


@flow(
    name="ingest-housing",
    retries=2,
    retry_delay_seconds=60,
    timeout_seconds=600,
    log_prints=True,
)
def ingest_housing():
    """Housing.com listings — every 3 hours."""
    logger = get_run_logger()
    logger.info("Starting Housing.com ingestion flow")
    from ingestion.ingest_housing import main
    main()
    logger.info("Housing.com ingestion flow complete")


@flow(
    name="ingest-telegram",
    retries=2,
    retry_delay_seconds=60,
    timeout_seconds=900,
    log_prints=True,
)
def ingest_telegram():
    """Telegram listings — every 3 hours."""
    logger = get_run_logger()
    logger.info("Starting Telegram ingestion flow")
    from ingestion.ingest_telegram import main
    main()
    logger.info("Telegram ingestion flow complete")


@flow(
    name="ingest-reddit",
    retries=2,
    retry_delay_seconds=120,
    timeout_seconds=900,
    log_prints=True,
)
def ingest_reddit():
    """Reddit listings — every 6 hours. Runs on local work pool (IP restrictions)."""
    logger = get_run_logger()
    logger.info("Starting Reddit listings ingestion flow")
    from ingestion.ingest_reddit import main
    main()
    logger.info("Reddit listings ingestion flow complete")


# ─────────────────────────────────────────────
# Pulse Ingestion Flows (2)
# ─────────────────────────────────────────────

@flow(
    name="scrape-reddit-discussions",
    retries=2,
    retry_delay_seconds=120,
    timeout_seconds=1200,
    log_prints=True,
)
def scrape_reddit_discussions():
    """Reddit discussions for Pulse — every 6 hours. Runs on local work pool."""
    logger = get_run_logger()
    logger.info("Starting Reddit discussions scrape flow")
    from ingestion.scrape_reddit_discussions import main
    main()
    logger.info("Reddit discussions scrape flow complete")


@flow(
    name="scrape-news",
    retries=2,
    retry_delay_seconds=60,
    timeout_seconds=600,
    log_prints=True,
)
def scrape_news():
    """Google News for Pulse — every 6 hours."""
    logger = get_run_logger()
    logger.info("Starting Google News scrape flow")
    from ingestion.scrape_news import main
    main()
    logger.info("Google News scrape flow complete")


# ─────────────────────────────────────────────
# Convenience: run all flows once (local testing)
# ─────────────────────────────────────────────

ALL_FLOWS = [
    ingest_nobroker,
    ingest_housing,
    ingest_telegram,
    ingest_reddit,
    scrape_reddit_discussions,
    scrape_news,
]

if __name__ == "__main__":
    print("Running all ingestion flows once (local test mode)...\n")
    for fn in ALL_FLOWS:
        try:
            fn()
        except Exception as e:
            print(f"  {fn.name} failed: {e}")
