#!/usr/bin/env python3
"""
Master ingestion runner — executes all source ingestion scripts.

Designed for cron / Railway: a single job that runs sources sequentially.
Each source is isolated so a failure in one doesn't block others.

Preset pipelines (recommended):
    python -m ingestion.run_all pulse        # Reddit discussions → News → Tag
    python -m ingestion.run_all listings     # NoBroker → Housing → Telegram → Reddit listings
    python -m ingestion.run_all pg           # Zolo → Colive → Stanza (PG-only)

Individual sources:
    python -m ingestion.run_all discussions news tag
    python -m ingestion.run_all reddit
    python -m ingestion.run_all stanza

Scheduling guide:
    pulse     — every 3 hours   (scrape discussions + news, then tag)
    listings  — every 6 hours   (listing sources only)
    pg        — every 12 hours  (PG aggregators: Zolo, Colive, Stanza)
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
    "nobroker":    [sys.executable, "-m", "ingestion.ingest_nobroker"],
    "housing":     [sys.executable, "-m", "ingestion.ingest_housing"],
    "99acres":     [sys.executable, "-m", "ingestion.ingest_99acres"],
    "telegram":    [sys.executable, "-m", "ingestion.ingest_telegram"],
    "reddit":      [sys.executable, "-m", "ingestion.ingest_reddit"],
    "zolo":        [sys.executable, "-m", "ingestion.ingest_zolo"],
    "colive":      [sys.executable, "-m", "ingestion.ingest_colive"],
    "stanza":      [sys.executable, "-m", "ingestion.ingest_stanza"],
    "news":        [sys.executable, "-m", "ingestion.scrape_news"],
    "discussions": [sys.executable, "-m", "ingestion.scrape_reddit_discussions"],
    "tag":         [sys.executable, "-m", "ingestion.tag_locality_feed"],
}

PIPELINES = {
    "pulse":    ["discussions", "news", "tag"],
    "listings": ["nobroker", "housing", "99acres", "telegram", "reddit"],
    "pg":       ["zolo", "colive", "stanza"],
}


def run_source(name: str, cmd: list[str]) -> bool:
    logger.info("─── Starting %s ───", name)
    start = time.time()
    try:
        result = subprocess.run(cmd, timeout=900, capture_output=False)
        elapsed = time.time() - start
        if result.returncode == 0:
            logger.info("─── %s completed in %.1fs ───", name, elapsed)
            return True
        else:
            logger.error("─── %s failed (exit %d) in %.1fs ───", name, result.returncode, elapsed)
            return False
    except subprocess.TimeoutExpired:
        logger.error("─── %s timed out after 900s ───", name)
        return False
    except Exception as e:
        logger.error("─── %s error: %s ───", name, e)
        return False


def main():
    args = [s.lower() for s in sys.argv[1:]] if len(sys.argv) > 1 else ["pulse"]

    requested: list[str] = []
    for arg in args:
        if arg in PIPELINES:
            requested.extend(PIPELINES[arg])
        elif arg in SOURCES:
            requested.append(arg)
        else:
            logger.error(
                "Unknown source/pipeline: '%s'. Valid sources: %s. Pipelines: %s",
                arg, list(SOURCES.keys()), list(PIPELINES.keys()),
            )
            sys.exit(1)

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for name in requested:
        if name not in seen:
            seen.add(name)
            unique.append(name)
    requested = unique

    logger.info("Running ingestion pipeline: %s", " → ".join(requested))
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
