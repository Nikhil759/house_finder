# Prefect + Railway Setup Guide

This guide covers the one-time setup to get the Prefect-orchestrated ingestion pipeline running.

---

## 1. Install Prefect Locally

```bash
cd backend
pip install -r requirements.txt
prefect version   # verify: should print 3.6+
```

---

## 2. Create a Prefect Cloud Workspace

1. Go to [app.prefect.cloud](https://app.prefect.cloud) and create a free account
2. Create a workspace (e.g. `nestiq`)
3. Generate an API key: **Settings → API Keys → Create API Key**
4. Log in from terminal:

```bash
prefect cloud login -k YOUR_API_KEY
```

---

## 3. Create Work Pools

Two work pools are needed:

### `railway-pool` — for NoBroker, Housing.com, Telegram, Google News

These scripts don't have IP restrictions and should run on Railway.

```bash
prefect work-pool create railway-pool --type process
```

### `local-pool` — for Reddit (listings + discussions)

Reddit blocks Railway's IP ranges. These flows run on your local machine.

```bash
prefect work-pool create local-pool --type process
```

---

## 4. Deploy All Flows

From the `backend/` directory:

```bash
prefect deploy --all
```

This reads `prefect.yaml` and registers all 6 deployments with their schedules.

Verify in Prefect Cloud dashboard: you should see 6 deployments under the workspace.

---

## 5. Start Workers

### Railway worker (for railway-pool)

Add these environment variables to your Railway service:

- `PREFECT_API_URL` — from Prefect Cloud workspace settings
- `PREFECT_API_KEY` — the API key from step 2
- All existing env vars (`DATABASE_URL`, `SUPABASE_DB_URL`, `GEMINI_API_KEY`, etc.)

Update the Procfile `worker` line:

```
worker: prefect worker start --pool railway-pool
```

Or create a dedicated Railway service for the worker.

### Local worker (for local-pool)

Run on your machine (or a machine with a residential IP):

```bash
cd backend
prefect worker start --pool local-pool
```

Keep this terminal open. The worker polls Prefect Cloud for scheduled runs on `local-pool` and executes them locally.

---

## 6. Verify Everything Works

### Trigger a test run manually:

```bash
# From the Prefect Cloud UI: click any deployment → "Quick Run"
# Or from CLI:
prefect deployment run 'ingest-nobroker/every-3h'
```

### Check the worker picked it up:

The worker terminal should show the flow starting, then the usual ingestion logs.

### Check Prefect Cloud dashboard:

Flow run should show as `Completed` with timing and logs.

---

## 7. Retire Local Crontab

Once all 6 flows are running successfully on Prefect for 24-48 hours:

```bash
crontab -e
# Comment out or delete all ingestion-related entries
```

Also move the old wrapper scripts to `scripts/dev/`:

```bash
mkdir -p scripts/dev
mv run_all.py scripts/dev/
mv run_pulse_cron.sh scripts/dev/ 2>/dev/null
mv run_reddit_cron.sh scripts/dev/ 2>/dev/null
mv run_reddit_discussions_cron.sh scripts/dev/ 2>/dev/null
```

---

## Schedule Summary

| Flow | Cron | Work Pool | Interval |
|---|---|---|---|
| `ingest-nobroker` | `0 */3 * * *` | railway-pool | Every 3h |
| `ingest-housing` | `10 */3 * * *` | railway-pool | Every 3h |
| `ingest-telegram` | `20 */3 * * *` | railway-pool | Every 3h |
| `ingest-reddit` | `0 */6 * * *` | local-pool | Every 6h |
| `scrape-reddit-discussions` | `30 */6 * * *` | local-pool | Every 6h |
| `scrape-news` | `45 */6 * * *` | railway-pool | Every 6h |

Offsets (10min, 20min, 30min, 45min) prevent all flows from starting simultaneously.
