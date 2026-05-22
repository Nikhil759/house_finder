#!/bin/bash
# Pulse pipeline — Reddit discussions only (Reddit blocks Railway IPs).
# Schedule on local macOS crontab: 0 */6 * * *
#   0 */6 * * * /path/to/run_pulse_cron.sh >> /path/to/logs/pulse_cron.log 2>&1
#
# For news sources (NewsAPI, Google News RSS, Citizen Matters), use Railway Cron:
#   bash scripts/run_pulse_railway_cron.sh
#   → python -m ingestion.run_all pulse_railway

set -euo pipefail
cd "$(dirname "$0")/.."
export PYTHONPATH="${PWD}:${PYTHONPATH:-}"

python -m ingestion.run_all discussions tag

