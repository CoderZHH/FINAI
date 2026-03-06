# FINAI Trading Platform

FINAI is an AI-assisted quantitative trading simulator built on Next.js. It keeps a live Binance futures feed, streams the data into LLM-driven agent models, executes the resulting trades in a paper account, and compares every strategy against an auto-funded BTC buy & hold benchmark. Each model receives CN¥10,000 in virtual capital on creation, can toggle auto-execution and human review, and renders its equity curve next to the benchmark in the dashboard.

## Getting Started

1. **Install dependencies**
   ```bash
   cd nof1-ui
   npm install
   ```
2. **Environment** – copy `.env.example` to `.env.local` and fill `POSTGRES_URL`, `POSTGRES_SSL` (if needed), plus LLM credentials (`api_base_url` / `api_key`).
   For production access control, set `FINAI_BASIC_AUTH_USER` and `FINAI_BASIC_AUTH_PASS`.
3. **Database reset** (dev server already runs this)
   ```bash
   node scripts/reset-db.js
   ```
4. **Run locally** – market data will auto-import for every model `allowed_symbols` (including the BTC benchmark) when the server starts
   ```bash
   npm run dev
   ```
   The dev server automatically starts the auto-runner loop that pulls Binance candles, updates the BTC benchmark, and schedules enabled agent models.
   For production (especially Vercel), run auto-runner in an independent worker process via `npm run worker`.

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
- 市场数据与指标：启动时会自动为所有模型的 `allowed_symbols`（含 BTC 基准）导入历史 1m/4h K 线，并在运行时持续增量同步。

## Project Map (功能树)

- 平台总览  
  - Next.js app with Edge/client routes，dev server自带行情循环与自动调度。  
  - 数据源：Postgres (accounts/trades/prices/logs) + Redis (队列/缓存)。
- 数据流总览  
  - 输入：Binance 行情、用户在 UI 的模型配置、LLM 决策输出。  
  - 处理：调度循环触发 LLM -> 决策执行 -> 更新 trades / runtime 账户 -> MTM -> 时间序列。  
  - 输出：模型卡片、折线图、日志流、审核提案、持仓概览。
- 前端页面 (app/)  
  - `app/models/page.js` 模型管理：创建/编辑模型、图表、卡片、日志抽屉、人工审核队列、自动运行开关。  
    - 表单字段：模型名、Provider/图标、API Base URL & Key、提示词选择、自动运行间隔、人工审核开关。  
    - 右侧：账户净值卡片、持仓卡片（多空、杠杆、数量、止盈止损）、折线图（模型 vs BTC 基准）、日志抽屉。  
    - 占位符库：展示模板可用 token（market_state_text 等）及示例。  
  - `app/settings/page.js` 设置中心：手续费/资金费率、逐仓 vs 全仓、风险分级、符号选择，悬浮问号提示。  
    - 分区：全局费率（maker/taker/资金费）、风险分级表（币种、名义区间、IMR、MMR、最大杠杆）、保证金模式切换。  
  - `app/api/*` Route Handlers：models、decisions、trades、positions、chart/performance、logs 等数据出口。  
  - `app/api/sim-config`：统一返回手续费、资金费率、风险分级，前后端共享。  
- 实时行情与基准 (lib/data/dataRepository.js, app/api/benchmark, ticker, symbols)  
  - 轮询 Binance futures 价格 -> `market_prices`。  
  - BTC Benchmark 初始化/更新，供折线图对比。  
- 模型与提示词 (app/api/models, prompt-templates, proposals)  
  - 模型 CRUD 与自动运行调度；支持人工审核的决策提案。  
  - 提示词模板库，模型绑定模板并下发占位符。  
- 决策执行链路 (lib/trading/autoRunner.js, decisionExecutor.js, markToMarket.js)  
  - 市场循环 1s：刷新价格、跑 MTM、追加账户时间序列。  
  - 调度循环 5s：按间隔触发 LLM 决策；支持暂停/恢复。  
  - 决策执行：写 `trades`，释放/占用保证金，落 runtime 账户，记录日志。  
  - MTM：用最新 mark_price 计算未实现盈亏、资金费率、手续费；写 `agent_account_timeseries`。  
  - 日志：`logger.info("(计算) ...")` 统一前缀，便于筛选计算链路。  
- 风控与仓位 (lib/risk.js, positions.js)  
  - 分级 IMR/MMR/最大杠杆：来源表 `risk_limits`，由设置页维护。  
    - 逻辑：根据 symbol(标准化为 SYMBOLUSDT)、notional 落入分级，输出 imr/mmr/max_leverage；缺省回退默认值。  
  - 符号规范：内部查询用 `SYMBOLUSDT`，展示时去掉 USDT；获取价格、IMR/MMR 时自动补/去后缀。  
  - 仓位映射：notional = price * quantity；初始/维持保证金按分级确定；支持多空。  
- 账户与资金 (agent_accounts_runtime, agent_account_timeseries, trades)  
  - runtime 账户：`wallet_balance`、`position_margin`、`available_cash`、`starting_equity`。  
  - 时间序列：每次 MTM/成交后写入，驱动折线图。  
  - trades：记录开仓/平仓、fee、pnl、止盈止损、杠杆。  
- 设置与种子 (lib/data/simConfig.js, simSettingsService.js, scripts/reset-db.js)  
  - `sim_settings`：手续费、资金费率、保证金模式，来自设置页。  
  - `risk_limits`：币种分级风控参数，设置页维护，reset-db 提供默认种子。  
  - reset-db：全量重建 schema、提示词模板、sim_settings、risk_limits、基准数据。  
- 日志与调试 (app/api/logs)  
  - SSE 输出 Log Console，含 LLM 请求/回应、决策链、风险结果。  
  - 错误/警告会带计算前缀，便于过滤。

## Deployment Notes

- Worker 部署方案：`docs/VERCEL_WORKER_PLAN.md`
- 数据库上线方案：`docs/DEPLOY_DATABASE.md`
