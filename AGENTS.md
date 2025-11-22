# Repository Guidelines

## Project Structure & Module Organization
The trading app lives in `nof1-ui`. `app/` holds the Next.js App Router routes plus `/api/*` handlers that orchestrate Redis, Postgres, and the LLM execution engine defined in `lib/`. UI primitives sit in `components/`, global styles in `app/globals.css`, and `public/` contains static glyphs used by the model cards. Operational scripts (`scripts/reset-db.js`, `scripts/get_market.js`) manage schema resets, Binance imports, and BTC benchmark funding. Prompt templates are managed inside the `/models` page and persisted exclusively via prompt_templates`—models now only reference those rows by id.

## Build, Test, and Development Commands
- `npm run dev` — loads `.env.local`, resets the schema, seeds templates + accounts, then runs `next dev` with the auto-runner + market loop enabled.
- `npm run build` / `npm run start` — production build and Node server for deployments.
- `npm run lint` — Next.js lint (requires Node ≥20.9).
- `npm run seed:static` / `node scripts/reset-db.js` — destructive reset plus prompt template seeding.
- `Invoke-WebRequest -Uri "http://localhost:3000/api/benchmark/init" -Method POST` — funds the BTC benchmark after seeding.
- The auto-runner exposes two cadence env vars: `MARKET_LOOP_INTERVAL_MS` (default 1 000 ms) for streaming prices/equity snapshots and `AUTO_RUNNER_TICK_MS` (default 5 000 ms) for evaluating when each model should fire its LLM (default `auto_run_interval_minutes` = 5). Tune them only if you really need slower/faster loops.

## Coding Style & Naming Conventions
All app code uses modern ES modules, 2-space indent, React function components, and Tailwind utility classes. Shared logic belongs in `lib/` (camelCase filenames) while rendered components are PascalCase. Prompts are edited through the template drawer; agent rows should never persist raw prompt text. Favor concise, data-oriented comments only when flows are non-obvious, and let the flat ESLint config enforce formatting.

## Testing Guidelines
There is no CI yet; before pushing changes run `npm run lint` locally and execute the manual loop (`npm run dev` → `npm run seed:static` → benchmark init) to ensure models auto-run, pending decisions can be approved, and the chart updates. When touching core libs (`dataRepository`, `decisionEngine`, `decisionExecutor`) add focused unit or integration tests under the same directory, or document manual verification steps in your PR.

## Commit & Pull Request Guidelines
Follow the existing short commit style (`api: stream pending logs`, `charts: add hover labels`). Every PR should explain schema updates (e.g., table drops), API contract changes, and UI behavior shifts, with screenshots or curl snippets where helpful. Mention any required `.env.local` variables. When the change affects the trading loop, outline how you validated LLM calls, trade inserts, and account snapshots.

## Security & Configuration Tips
Keep secrets in `.env.local` only. Required values: `POSTGRES_URL`, optional `POSTGRES_SSL`, `REDIS_URL`, LLM credentials, and Binance overrides (`BINANCE_BASE_URL`, `GET_MARKET_*`). `scripts/reset-db.js` now creates only the live tables (`agent_models`, `agent_accounts_runtime`, `agent_account_timeseries`, `market_prices`, `market_price_history`, `prompt_templates`, `agent_logs`, `trades`), so run it only when you intend to drop everything. Benchmark metadata (BTC quantity) lives inside `agent_accounts_runtime.metadata`; double-check the target database before running destructive scripts.

## Simulator Config (no sim_config.json)
Runtime simulator settings (fees, funding) are stored in Postgres table `sim_settings` and seeded by `scripts/reset-db.js`; `sim_config.json` is deprecated. Adjust fees/funding via `/settings` UI or by changing the seed defaults. No ALTERs are needed because `npm run dev` recreates the schema each run.
