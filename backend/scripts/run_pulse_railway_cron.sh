#!/bin/bash
# Pulse pipeline for Railway Cron (no Reddit — blocked on Railway IPs).
# Schedule on Railway: 0 */3 * * *  (every 3 hours)
#
# Command:
#   bash scripts/run_pulse_railway_cron.sh
#
# Requires env: SUPABASE_DB_URL or DATABASE_URL, NEWS_API_KEY, GEMINI_API_KEY

set -euo pipefail
cd "$(dirname "$0")/.."
export PYTHONPATH="${PWD}:${PYTHONPATH:-}"

python -m ingestion.run_all pulse_railway
