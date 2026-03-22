#!/bin/bash
cd /Users/nikhilbansal/Downloads/reddit-housing/backend
export PYTHONPATH="/Users/nikhilbansal/Downloads/reddit-housing/backend:$PYTHONPATH"
/Library/Developer/CommandLineTools/usr/bin/python3 -m ingestion.ingest_reddit
