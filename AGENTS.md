# Repository Guidelines

## Project Structure
- All code lives in `nof1-ui/`. Routes and API handlers sit in `app/`, shared logic in `lib/`, UI primitives in `components/`, global styles in `app/globals.css`, assets in `public/`, and operational scripts in `scripts/` (only `reset-db.js` now).
- Market data flows through `lib/marketImporter.js` (klines + indicators + open interest/funding history) and `lib/autoRunner.js` (market loop + model dispatcher). Market history seeds automatically for every model `allowed_symbols` (BTC benchmark included); no standalone seeding script.
- LLM/trading pipeline lives in `lib/decisionEngine.js` + `lib/decisionExecutor.js`; data access helpers in `lib/dataRepository.js`. Prompt templates are managed in `/models` UI and stored in `prompt_templates`, referenced by `prompt_template_id` on `agent_models`.

## Commands
- `npm run dev` — loads `.env.local`, runs `node scripts/reset-db.js`, then starts Next dev with the market loop + auto-runner.
- `npm run build` / `npm run start` — production build and serve.
- `npm run lint` — Next.js lint (requires Node ≥20.9).
- `node scripts/reset-db.js` — destructive reset + prompt template seeding (same reset run by `npm run dev`).

## Runtime & Loops
- Auto-runner has two cadences: `MARKET_LOOP_INTERVAL_MS` (default 1 000 ms) for price sync/MTM/history snapshots, and `AUTO_RUNNER_TICK_MS` (default 5 000 ms) for scheduling LLM calls (per-model `auto_run_interval_minutes`, default 5).
- Market history import: `marketImporter.syncLatestMarketData` pulls 1m/4h klines + indicators + OI/funding into `market_price_history` and upserts `market_prices` for tracked `allowed_symbols`. It retries with/without proxy.
- Risk/funding sync: auto-runner calls internal APIs `/api/binance/risk` and `/api/binance/funding` (same logic UI uses).

## Env & Connectivity
- Core: `POSTGRES_URL`, optional `POSTGRES_SSL`, `REDIS_URL`, `BINANCE_API_BASE` (spot 24h ticker), `BINANCE_FAPI_BASE` (futures).
- Keys: `BINANCE_API_KEY`, `BINANCE_API_SECRET` (or testnet variants below).
- Testnet toggle: set `BINANCE_TESTNET=true` and provide `BINANCE_API_KEY_TEST` / `BINANCE_API_SECRET_TEST`; override base with `BINANCE_FAPI_BASE_TEST` (default `https://testnet.binancefuture.com`). Risk/funding APIs honor this; set bases/keys consistently if you want the rest of the app to use testnet.
- Proxy: `HTTPS_PROXY` / `HTTP_PROXY` / `GET_MARKET_PROXY` are passed to klines/OI/funding fetches; failures fall back to direct fetch.
- Historical import window: `GET_MARKET_LOOKBACK_DAYS`, `GET_MARKET_HTF_LOOKBACK_DAYS`, `GET_MARKET_START`, `GET_MARKET_END`, `GET_MARKET_RETRY`.

## Schema & Data
- `scripts/reset-db.js` builds live tables only: `prompt_templates`, `agent_models`, `agent_accounts_runtime`, `agent_account_timeseries`, `market_prices`, `market_price_history`, `agent_logs`, `trades`, plus `risk_limits`, `insurance_fund`, `sim_settings`.
- BTC benchmark lives in `agent_models`/`agent_accounts_runtime` with metadata (quantity/entry) in `agent_accounts_runtime.metadata`. Auto-runner initializes/marks it each start.

## Coding Style
- ES modules, 2-space indent, React function components, Tailwind utilities. Shared logic stays in `lib/` (camelCase filenames), rendered components use PascalCase. Keep comments concise and only for non-obvious flows; formatter/lint handles the rest.

## Testing & Validation
- No CI. Before pushing: run `npm run lint` and manual loop (`npm run dev`, create a model, ensure auto-run updates prices/logs/equity chart). When touching core libs (`dataRepository`, `decisionEngine`, `decisionExecutor`, `marketImporter`, `autoRunner`), add focused tests nearby or document manual steps.

## Commit & PR
- Use short commit subjects (`api: ...`, `charts: ...`). PRs should call out schema changes, API contract changes, and UI behavior shifts, with screenshots or curl snippets when useful. Mention required env vars and how trading loop was validated (LLM calls, trade inserts, account snapshots).
