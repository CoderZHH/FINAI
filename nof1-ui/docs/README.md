# FINAI Trading Platform

FINAI is an AI-assisted quantitative trading simulator built on Next.js. It keeps a live Binance futures feed, streams the data into LLM-driven agent models, executes the resulting trades in a paper account, and compares every strategy against an auto-funded BTC buy & hold benchmark. Each model receives CN¥10,000 in virtual capital on creation, can toggle auto-execution and human review, and renders its equity curve next to the benchmark in the dashboard.

## Getting Started

1. **Install dependencies**
   ```bash
   cd nof1-ui
   npm install
   ```
2. **Environment** – copy `.env.example` to `.env.local` and fill `POSTGRES_URL`, `POSTGRES_SSL` (if needed), `REDIS_URL`, and LLM credentials (`api_base_url` / `api_key`).
3. **Database reset & seed**
   ```bash
   npm run seed:static   # rewrites schema, seeds prompt templates & prompt metadata
   Invoke-WebRequest -Uri "http://localhost:3000/api/benchmark/init" -Method POST  # fund BTC benchmark
   ```
4. **Run locally**
   ```bash
   npm run dev
   ```
   The dev server automatically starts the auto-runner loop that pulls Binance candles, updates the BTC benchmark, and schedules enabled agent models.

## Core Concepts

- `agent_models` only store runtime config + a `prompt_template_id`; the template manager owns the actual system/user prompts. New models automatically seed runtime accounts with ¥10k simulated cash and initialize `agent_account_timeseries` for charting.
- `trades` now represent both open and closed positions. The execution engine writes new trades on every LLM decision, and closing a symbol updates those rows while releasing cash back into `agent_accounts_runtime`.
- `agent_logs` doubles as the decision queue: entries flagged with `review_status = 'pending'` appear in the Strategy Confirmation panel, and approvals call the same execution engine used for auto-runs.
- Equity curves draw from `agent_account_timeseries`, which is refreshed once per second (market loop) and after every execution so the BTC benchmark and all models update near real time.
- The auto-runner contains two loops: a 1 s **market loop** (`MARKET_LOOP_INTERVAL_MS`) that fetches Binance prices, updates BTC benchmark equity, and runs `markToMarketAllModels`, and a dispatcher loop (`AUTO_RUNNER_TICK_MS`, default 5 s) that checks each model’s `auto_run_interval_minutes` and triggers LLM calls (default 5 minutes per model). Override the cadence through environment variables if you need slower or faster ticks.

## Typical Workflow

1. Manage prompt templates in **/models → 提示词管理**; insert placeholders such as `{market_state_text}` directly from the built-in token palette.
2. Create a model, choose the template, paste LLM credentials, and enable auto-run + optional human review.
3. Start the dev server and watch `/api/logs/stream` or the in-app Log Console for each LLM invocation and resulting trades.
4. Approve or reject pending decisions in the right-hand panel; approvals write trades & account snapshots immediately.

## Useful Commands

- `npm run dev` – reset local DB, start the Next.js dev server, auto-runner, and market loop.
- `npm run build && npm run start` – production build & serve.
- `npm run lint` – lint the codebase (requires Node ≥20.9). 
- `node scripts/reset-db.js` – destructive schema reset; rerun any time the DB drifts.
- `node scripts/get_market.js` – optional Binance history import.
