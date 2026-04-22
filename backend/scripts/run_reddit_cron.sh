#!/bin/bash
cd /Users/nikhilbansal/Developer/house_finder/backend
export PYTHONPATH="/Users/nikhilbansal/Developer/house_finder/backend:$PYTHONPATH"
source /Users/nikhilbansal/Developer/house_finder/backend/venv/bin/activate
python -m ingestion.ingest_reddit
