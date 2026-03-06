# Agent 系统技术白皮书

本档案描述 FINAI 项目中基于 LLM 的交易 Agent 全栈实现，涵盖模型定义、调度、行情与交易流水、数据表协作、运行循环、调试与最佳实践。内容基于仓库现有结构与代码（`finai-zhh`）。

---

## 1. 系统中 “Agent” 的定义
- **Agent 是什么**：`agent_models` 表中的一行即一个交易 Agent。绑定提示词模板、可交易符号集、LLM 访问参数、自动运行节奏、图标与风控开关。
- **核心字段**
  - `model_id`：唯一标识。
  - `display_name` / `display_icon`：展示。
  - `provider` / `llm_model` / `api_base_url` / `api_key`：LLM 调用配置（provider 为描述，`llm_model`/`api_base_url`/`api_key` 用于请求）。
  - `prompt_template_id`：关联 `prompt_templates`.
  - `allowed_symbols`：允许交易的基础符号（内部统一转 `SYMBOLUSDT`）。
  - `auto_run_enabled` / `auto_run_interval_minutes` / `last_auto_run_at` / `next_auto_run_at`：调度配置。
  - `margin_config`：符号→保证金模式（交叉/逐仓）。
- **生命周期**
  1) 创建：UI `/models` 表单 → `/api/models` → `createAgentModel`；初始化 runtime 账户与首次时间序列。
  2) 冷启动行情：`importMarketData` 拉所选符号历史 klines/指标/OI/Funding，写入 `market_price_history` + `market_prices`。
  3) 运行：auto-runner 定期调度 → `decisionEngine` 构造 prompt → 调 LLM → `decisionExecutor` 落地交易与账户更新。
  4) 观测：`agent_logs` 记录请求/响应/错误/审核，`agent_account_timeseries` 驱动 equity 曲线，`trades` 审计成交。
  5) 终止：关闭 auto-run 或不再调用；删除模型不会自动清历史记录。
- **职责**：基于提示词与最新行情生成交易决策；决策需满足符号/风险约束，执行后更新账户与日志。

---

## 2. 整体架构

### 代码组织
```
finai-zhh/
  app/                Next.js routes + API handlers
    api/              REST handlers（models, trades, risk, funding, ticker, markets...）
    models/page.js    模型管理 UI（创建/编辑 Agent、提示词）
    settings/page.js  风险/手续费设置
  lib/                核心逻辑
    autoRunner.js     调度器：市场循环 + 模型调度
    marketImporter.js 行情历史导入/增量同步 + 指标/OI/Funding
    decisionEngine.js Prompt 构造 + LLM 调用 + 决策解析
    decisionExecutor.js 交易执行/风险校验/账户更新
    dataRepository.js 数据访问与聚合（行情、账户、模型、风险）
    llmClient.ts      LangChain LLM 客户端（TypeScript）
  scripts/reset-db.js 重建 schema + 默认模板/设置
  prompts/            默认模板（系统/用户/示例）
```

### 高层架构图（ASCII）
```
[UI /models] --CRUD--> /api/models --dataRepository--> agent_models
    |                                \--> prompt_templates
    |
    v
[autoRunner]
  ├─ market loop (MARKET_LOOP_INTERVAL_MS)
  │   ├─ syncLatestMarketData -> market_price_history / market_prices
  │   ├─ updateMarketPricesFromBinance -> market_prices
  │   ├─ updateBtcBenchmark / markToMarketAllModels -> timeseries/runtime
  │   └─ syncRiskAndFunding -> /api/binance/risk & /api/binance/funding
  └─ dispatch loop (AUTO_RUNNER_TICK_MS)
      └─ pick due agents -> decisionEngine -> decisionExecutor
```

### 数据流（含 BTC 基准）
```
Binance APIs
  ├─ klines (1m/4h) ─┐
  ├─ openInterest    ├→ marketImporter → market_price_history / market_prices
  └─ fundingRate     ┘
                       │
[autoRunner market loop] ---snapshots/MTM--> agent_account_timeseries, agent_accounts_runtime
                       │
                       └─ updateBtcBenchmark (特殊 agent `btc_benchmark` 用 BTCUSDT 现价标记)

[decisionEngine] uses:
  - prompt_templates (system/user)
  - getMarketSnapshot() (market_prices/history)
  - runtime account/positions
  -> LLM JSON decisions

[decisionExecutor]
  -> trades
  -> agent_accounts_runtime
  -> agent_account_timeseries
  -> agent_logs
```

---

## 3. Prompt 模板体系（prompt_templates）
- **管理**：UI `/models` “提示词管理” 抽屉，CRUD `prompt_templates`。
- **表结构关键字段**
  - `template_name` / `description`
  - `system_prompt` / `user_prompt`
  - `placeholder_tokens`（占位符列表）
  - `is_default`
  - 示例：`sample_market_state_text` / `sample_position_state_text`。
- **绑定与下发**
  - `agent_models.prompt_template_id` 指向模板；创建/编辑模型时选择模板，若为空则用默认模板。
  - `decisionEngine`：拉取 agent+模板 → `buildPromptReplacements` 生成替换映射（行情、账户、调用次数、时间等）→ `fillTemplate` 得到最终 system/user prompt。
- **新模板建议**
  - 复制旧模板创建新版本，避免覆盖历史。
  - 明确输出 JSON schema 与风险约束（止盈/止损/杠杆上限/符号限制）。
  - 保持占位符与 `placeholder_tokens` 同步（代码自动提取 `{token}`）。

---

## 4. 市场数据系统（marketImporter + autoRunner）
- **数据源**：Binance USDT 永续
  - K线 `/fapi/v1/klines` 1m/4h：附 EMA20/50、MACD、RSI7/14、ATR3/14、VolumeAvg。
  - OI `/futures/data/openInterestHist` 5m。
  - Funding `/fapi/v1/fundingRate`。
- **存储**
  - 最新快照：`market_prices`（价格/涨跌/量/EMA/MACD/RSI/ATR/OI/Funding/HTF）。
  - 历史：`market_price_history`（symbol + timeframe=1m/4h + ts + 指标/OI/Funding）。
- **导入/同步**
  - `importMarketData(symbols)`：冷启动全量窗口。
  - `syncLatestMarketData(symbols)`：增量同步，基于历史最大 ts + 预热窗口，避免重复写。
  - 重试/代理：undici ProxyAgent，失败退直连；`GET_MARKET_RETRY` 控制重试；proxy 环境变量 `GET_MARKET_PROXY`/`HTTPS_PROXY`/`HTTP_PROXY`。
- **auto-runner 市场循环**
  - 间隔 `MARKET_LOOP_INTERVAL_MS`（默认 1s）。
  - 顺序：`syncLatestMarketData` → `updateMarketPricesFromBinance` → `updateBtcBenchmark` → `markToMarketAllModels` → 周期性 `syncRiskAndFunding`。
  - 启动时：全量导入 tracked symbols 历史，再同步风险/资金费。

---

## 5. Agent 执行流程

### 5.1 auto-runner 选择 Agent
- 条件：`auto_run_enabled=true`，当前时间 ≥ `next_auto_run_at`（由 `auto_run_interval_minutes` 推算）。
- 防重入：`isModelRunning(modelId)`。
- 运行后更新：`last_auto_run_at` / `next_auto_run_at`。

### 5.2 Pipeline 概览
```
行情导入/增量 (marketImporter)
      ↓
dataRepository 聚合行情/账户
      ↓
decisionEngine 构造 prompt + 调 LLM
      ↓
decisionExecutor 校验/落地 trades
      ↓
更新 runtime 账户 + timeseries + logs
```

### 5.3 decisionEngine 细节
1) **加载配置**：`getAgentModelById(includeSecrets=true)` 获取 api_base_url/api_key/llm_model/allowed_symbols。
2) **构建上下文**：
   - `getMarketSnapshot()`：按 allowed_symbols 返回最新价/指标。
   - `buildMarketStateText(symbols)`：每符号当前指标 + 近 1m/4h 序列摘要。
   - 账户/持仓：runtime 账户、Sharpe、调用次数。
3) **填充模板**：`fillTemplate(system_prompt/user_prompt, replacements)` 替换 `{market_state_text}` 等。
4) **LLM 调用**：`callLLM({ apiBaseUrl, apiKey, model: llm_model, systemPrompt, userPrompt })`，期望 JSON 决策数组。
5) **解析/校验**：`normalizeDecisionMap` 强制字段/正负关系，非法则抛错。
6) **错误处理**：LLM 失败/格式错误 → 写日志并抛出，auto-runner 捕获后跳过该 agent。

### 5.4 decisionExecutor 细节
- **输入**：决策 map、行情（mark price）、账户状态、风险限额。
- **校验**：
  - 符号必须在 `allowed_symbols`。
  - 资金/杠杆检查：基于 `risk_limits`（IMR/MMR/最大杠杆）与可用资金。
  - 头寸限制：禁止部分平仓/对冲/加仓（按信号开/平）。
- **落地**：
  - 写 `trades`：方向、数量、价格、fee、pnl。
  - 更新 `agent_accounts_runtime`：余额、保证金、未实现盈亏、metadata。
  - 记录 `agent_account_timeseries`：equity/cash/unrealized/realized。
  - 记录 `agent_logs`：请求/响应/错误/审核状态。
- **无效决策**：仅日志，账户不变。

---

## 6. 数据存储模型（Postgres 表协作）

| 表名 | 作用 | 关键字段/关系 |
| --- | --- | --- |
| `agent_models` | Agent 配置 | prompt_template_id → prompt_templates；allowed_symbols；api_base_url/key；llm_model；auto_run 配置；display_icon |
| `prompt_templates` | 提示词模板 | system_prompt/user_prompt/placeholder_tokens/is_default/示例 |
| `agent_accounts_runtime` | 实时账户 | model_id PK/FK；starting/latest equity；available_cash；total_unrealized_pnl；metadata |
| `agent_account_timeseries` | Equity 曲线 | model_id FK；ts/equity/cash/unrealized/realized |
| `agent_logs` | 决策日志 | model_id；payload/response/error/review |
| `trades` | 交易记录 | model_id；symbol；方向/数量/价格/fee/pnl；开/平 |
| `market_prices` | 最新行情 | symbol PK；price/change/volume/EMA/MACD/RSI/ATR/OI/Funding/HTF |
| `market_price_history` | 历史行情 | symbol+timeframe+ts PK；price_mid/指标/OI/Funding |
| `risk_limits` | 风控分层 | symbol+tier；notional_cap/max_leverage/imr/mmr |
| `insurance_fund` | 保险基金 | balance |
| `sim_settings` | 费用/资金费等 | fees JSON |

依赖：`agent_models` 为核心；runtime/日志/交易/时间序列均以 `model_id` 关联；行情表按 `symbol`；风险表按 `symbol`。

---

## 7. 运行时循环
- **环境变量**：
  - `MARKET_LOOP_INTERVAL_MS`（默认 1000ms）：行情增量 + 价格快照 + MTM + 周期性风险同步。
  - `AUTO_RUNNER_TICK_MS`（默认 5000ms）：检查 agent 调度。
  - `auto_run_interval_minutes`（每模型）：LLM 调度节奏。
- **解耦**：市场 loop 与调度 loop 分离，先行情再决策；调度频率受每模型间隔约束。
- **防过频**：`auto_run_interval_minutes` 最小 1 分钟。
- **运行方式**：
  - 开发：`npm run dev`（自动 reset-db + Next 开发 + auto-runner）。
  - 生产：`npm run build && npm run start`。
- **Reset**：`scripts/reset-db.js` 重建 schema + 默认模板/设置 + sim_settings；`npm run dev` 启动自动执行。

---

## 8. 监控、日志与调试
- **agent_logs**：记录每次 LLM 请求/响应/错误/审核；调试接口 `/api/agents/[id]/logs`（UI 日志面板）。
- **trades**：审计每笔开/平仓及 fee/pnl。
- **timeseries**：`agent_account_timeseries` 驱动 equity 曲线；MTM/交易后写入。
- **卡顿检查**：`last_auto_run_at` / `next_auto_run_at`；长时间不更新则 auto-runner/LLM 可能异常。
- **提示词调试**：在 `/models` 编辑模板，确认占位符替换与输出 JSON 格式；LLM 失败时查 `agent_logs`。
- **行情调试**：若 `market_price_history` 缺数据，检查符号有效性/网络代理；`market_prices` 是否更新。

---

## 9. 新增一个 Agent（实操）
1) 在 `/models` → “提示词管理” 创建/选择模板，确保输出严格 JSON、声明风险约束与符号范围。
2) “新增模型”填写：显示名、模型提供商（描述）、模型名称（llm_model）、API Base URL、API Key、图标、交易对（allowed_symbols）、提示词模板、人工审核、自动执行周期。
3) 保存后自动：写入 `agent_models`；初始化 runtime 账户/时间序列；`importMarketData` 拉历史；`syncRiskAndFunding` 调内部 API。
4) 运行验证：开启自动执行或等待调度；查看 `agent_logs`/`trades`/equity。
5) 建议：少量符号+较长周期测试；确保 `risk_limits` 覆盖符号；提示词强调止盈/止损/杠杆上限与严格 JSON。

---

## 10. 最佳实践
- Prompt：明确 JSON schema（字段/类型/约束），强调“仅返回 JSON”；声明止盈/止损/杠杆/单笔上限。
- 频率：合理设置 `auto_run_interval_minutes`；行情与决策已解耦。
- 风控：`risk_limits` 覆盖符号；执行前资金/杠杆检查；提示词限单笔资金占比。
- 可解释性：输出 `justification`、`invalidation_condition`；利用 EMA/MACD/RSI/ATR/OI/Funding 提供依据。
- 输出稳定：严格 JSON 数组；失败在 `agent_logs` 留痕。
- 上生产：先 Testnet（通过 env 切换 base/key）验证行情/风控/交易，再切正式 key；`.env.local` 保管 secrets。

---

## 附：关键流程示例

### 创建模型（POST /api/models）
```json
{
  "display_name": "Trend Alpha",
  "provider": "DeepSeek",
  "llm_model": "deepseek-reasoner",
  "api_base_url": "https://api.deepseek.com",
  "api_key": "sk-***",
  "prompt_template_id": "<uuid>",
  "allowed_symbols": ["BTC", "ETH"],
  "auto_run_enabled": true,
  "auto_run_interval_minutes": 5,
  "display_icon": "icon:deepseek",
  "human_review_required": false,
  "margin_config": { "BTC": "cross", "ETH": "cross" }
}
```

### auto-runner 市场循环（每 1s）
```
syncLatestMarketData(trackedSymbols)
→ updateMarketPricesFromBinance()
→ updateBtcBenchmark()
→ markToMarketAllModels()
→ (周期性) syncRiskAndFunding()
```

### 调度循环（每 5s）
```
load agents → filter auto_run_enabled & due
→ for each:
    decisionEngine(model)
      → callLLM(api_base_url/api_key/llm_model)
      → parse decisions
    decisionExecutor(decisions, risk_limits, prices)
      → trades + runtime + timeseries + logs
```
