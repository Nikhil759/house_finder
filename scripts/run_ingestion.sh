#!/bin/bash
# Reddit ingestion cron wrapper.
#
# Setup:
#   1. Copy scripts/.env.example to scripts/.env and fill in DATABASE_URL
#   2. Make executable: chmod +x scripts/run_ingestion.sh
#   3. Add to crontab (every 6 hours):
#      crontab -e
#      0 */6 * * * /path/to/reddit-housing/scripts/run_ingestion.sh >> /path/to/reddit-housing/logs/reddit_ingest.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load env vars (DATABASE_URL for Railway Postgres)
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
fi

# Also load backend .env for any shared vars
if [ -f "$PROJECT_DIR/backend/.env" ]; then
    set -a
    source "$PROJECT_DIR/backend/.env"
    set +a
fi

# Create logs directory if it doesn't exist
mkdir -p "$PROJECT_DIR/logs"

# Use the venv Python if available, otherwise system Python
if [ -f "$PROJECT_DIR/backend/venv/bin/python" ]; then
    PYTHON="$PROJECT_DIR/backend/venv/bin/python"
elif [ -f "$PROJECT_DIR/backend/venv/bin/python3" ]; then
    PYTHON="$PROJECT_DIR/backend/venv/bin/python3"
else
    PYTHON="python3"
fi

echo ""
echo "$(date '+%Y-%m-%d %H:%M:%S') Starting Reddit ingestion..."
echo "Python: $PYTHON"

$PYTHON "$SCRIPT_DIR/ingest_reddit.py"
EXIT_CODE=$?

echo "$(date '+%Y-%m-%d %H:%M:%S') Done (exit code: $EXIT_CODE)"
