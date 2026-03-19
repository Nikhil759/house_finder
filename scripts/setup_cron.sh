#!/bin/bash
# Sets up the Reddit ingestion launchd job (macOS).
# Run once: bash scripts/setup_cron.sh
# To uninstall: bash scripts/setup_cron.sh uninstall

PLIST_NAME="com.reddit-housing.ingest"
PLIST_SRC="$(cd "$(dirname "$0")" && pwd)/$PLIST_NAME.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
LOG_DIR="$(cd "$(dirname "$0")/.." && pwd)/logs"

if [ "${1}" = "uninstall" ]; then
    launchctl unload "$PLIST_DEST" 2>/dev/null
    rm -f "$PLIST_DEST"
    echo "Reddit ingestion job removed."
    exit 0
fi

mkdir -p "$LOG_DIR"

# Copy plist to LaunchAgents
cp "$PLIST_SRC" "$PLIST_DEST"

# Unload first in case it was already registered
launchctl unload "$PLIST_DEST" 2>/dev/null

# Load the job
launchctl load "$PLIST_DEST"

echo ""
echo "Reddit ingestion job registered with launchd."
echo "  Runs every 6 hours automatically."
echo "  Logs: $LOG_DIR/reddit_ingest.log"
echo ""
echo "To run immediately:"
echo "  launchctl start $PLIST_NAME"
echo ""
echo "To uninstall:"
echo "  bash scripts/setup_cron.sh uninstall"
