#!/usr/bin/env python3
"""
Master ingestion runner — executes all source ingestion scripts.

Designed for Railway cron: a single job that runs all sources sequentially.
Each source is isolated so a failure in one doesn't block others.

Usage:
    python -m ingestion.run_all              # run all sources
    python -m ingestion.run_all reddit       # run specific source(s)
    python -m ingestion.run_all nobroker housing
"""

from __future__ import annotations

import logging
import subprocess
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("run_all")

SOURCES = {
    "nobroker":  [sys.executable, "-m", "ingestion.ingest_nobroker"],
    "housing":   [sys.executable, "-m", "ingestion.ingest_housing"],
    "telegram":  [sys.executable, "-m", "ingestion.ingest_telegram"],
    "reddit":    [sys.executable, "-m", "ingestion.ingest_reddit"],
    "news":      [sys.executable, "-m", "ingestion.scrape_news"],
    "discussions": [sys.executable, "-m", "ingestion.scrape_reddit_discussions"],
    "tag":       [sys.executable, "-m", "ingestion.tag_locality_feed"],
}


def run_source(name: str, cmd: list[str]) -> bool:
    logger.info("─── Starting %s ───", name)
    start = time.time()
    try:
        result = subprocess.run(cmd, timeout=600, capture_output=False)
        elapsed = time.time() - start
        if result.returncode == 0:
            logger.info("─── %s completed in %.1fs ───", name, elapsed)
            return True
        else:
            logger.error("─── %s failed (exit %d) in %.1fs ───", name, result.returncode, elapsed)
            return False
    except subprocess.TimeoutExpired:
        logger.error("─── %s timed out after 600s ───", name)
        return False
    except Exception as e:
        logger.error("─── %s error: %s ───", name, e)
        return False


def main():
    requested = [s.lower() for s in sys.argv[1:]] if len(sys.argv) > 1 else list(SOURCES.keys())
    invalid = [s for s in requested if s not in SOURCES]
    if invalid:
        logger.error("Unknown sources: %s. Valid: %s", invalid, list(SOURCES.keys()))
        sys.exit(1)

    logger.info("Running ingestion for: %s", ", ".join(requested))
    results = {}
    for name in requested:
        results[name] = run_source(name, SOURCES[name])

    passed = sum(1 for v in results.values() if v)
    failed = sum(1 for v in results.values() if not v)
    logger.info("Done: %d/%d succeeded, %d failed", passed, len(results), failed)

    if failed:
        logger.warning("Failed sources: %s", [k for k, v in results.items() if not v])


if __name__ == "__main__":
    main()
