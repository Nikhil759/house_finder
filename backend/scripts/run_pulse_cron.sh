#!/bin/bash
# Pulse pipeline: Reddit discussions → News → Gemini tagger
# Schedule: every 3 hours via crontab or launchd
# crontab entry: 0 */3 * * * /path/to/run_pulse_cron.sh >> /path/to/logs/pulse_cron.log 2>&1
cd /Users/nikhilbansal/Downloads/reddit-housing/backend
export PYTHONPATH="/Users/nikhilbansal/Downloads/reddit-housing/backend:$PYTHONPATH"
/Library/Developer/CommandLineTools/usr/bin/python3 -m ingestion.run_all pulse
