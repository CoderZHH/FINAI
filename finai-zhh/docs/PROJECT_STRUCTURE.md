# 项目结构与文件职能清单

> 目的：快速定位代码、避免“文件太乱”。以下按功能域分组，列出关键文件的职责与使用场景，保持与现有路径一致（未移动文件）。

## 根目录与外围
- `AGENT.md`：Agent/自动交易架构详解。
- `binance-spot-api-docs-master/**`：币安官方现货/Testnet 文档和示例（仅参考，不参与构建）。

## 工程配置（finai-zhh）
- `package.json` / `package-lock.json`：依赖、脚本。
- `tsconfig.json` / `tsconfig.tsbuildinfo`：TypeScript/JS 路径配置，`@/*` 指向项目根。
- `next.config.mjs` / `eslint.config.mjs` / `postcss.config.cjs` / `jsconfig.json` / `next-env.d.ts` / `instrumentation.js`：Next.js 构建、Lint、全局插桩。

## 核心库（finai-zhh/lib）
### 基础设施
- `db.js`：PostgreSQL 连接池。
- `logManager.js`：统一日志缓冲与 SSE 推送。
- `simConfig.js`：模拟手续费配置缓存/读写。
- `simSettingsService.js`：风险限额持久化工具。

### 数据与市场
- `dataRepository.js`：DB 读写总线，账户/行情/日志/交易等 CRUD。
- `marketImporter.js`：从 Binance 拉取 kline/指标写入 `market_price_history`。
- `symbols.js`：交易对标准化与默认符号解析。
- `riskLimits.js`：风险分层读取与计算。
- `insuranceFund.js`：保险基金余额管理。

### 交易执行与风控
- `autoRunner.js`：市场循环 + 模型自动调度。
- `scripts/worker.js`：独立 worker 入口（生产环境建议由该进程托管 autoRunner）。
- `decisionEngine.js`：构建 Prompt 调用 LLM。
- `decisionExecutor.js`：解析决策、落地 trades/仓位。
- `liquidationEngine.js`：强平流程。
- `adlEngine.js`：ADL 损失分摊。

### LLM 与提示词
- `llmClient.ts`：多提供商 LLM 客户端。
- `promptBuilder.js`：提示词模板替换/拼装。
- `modelIcons.js`：模型图标映射。

## 页面（Next.js App Router）
- `app/layout.js`：全局布局。
- `app/page.js`：仪表盘首页。
- `app/settings/page.js`：设置页。
- `app/models/page.js`：模型管理表单/抽屉。
- `app/globals.css`：全局样式。

## API 路由（app/api）
### 行情/资产
- `api/markets/binance/route.js`：Binance 24h 行情汇总。
- `api/ticker/route.js`：内部行情快照。
- `api/symbols/route.js`：可用符号列表。
- `api/asset-logo/route.js`：币种图标代理。

### 模型与提示词
- `api/models/route.js`、`api/models/[modelId]/route.js`：模型 CRUD/冷启动。
- `api/prompt-templates/route.js`、`api/prompt-templates/[templateId]/route.js`：提示词模板 CRUD。

### 决策与执行
- `api/decisions/pending/route.js`：待审核决策列表。
- `api/decisions/confirm/route.js`：人工确认执行。

### 账户/交易/日志
- `api/positions/current/route.js`：当前仓位。
- `api/trades/recent/route.js`：最新成交。
- `api/agents/logs/route.js`、`api/logs/stream/route.js`：Agent 日志查询/SSE 流。
- `api/performance/since-inception/route.js`、`api/performance/timeseries/route.js`：绩效/权益时间序列。

### 资金费与风险
- `api/binance/risk/route.js`：风险分层同步。
- `api/binance/funding/route.js`：资金费同步。
- `api/sim-config/route.js`：模拟交易手续费配置。

## 组件（finai-zhh/components）
- `Header.js`、`TickerBar.js`、`RightFeed.js`：页面框架/行情侧边栏。
- `ChartPanel.js`、`ChartInner.js`：图表/曲线展示。
- `CoinBadge.js`：币种徽章。
- `LogConsole.js`：日志流 UI（SSE）。

## 脚本与运维
- `scripts/reset-db.js`：重置/建表/种子。
- `scripts/utils/loadEnv.js`：加载 `.env*` 文件。

## 文档与提示词
- `docs/README.md`、`docs/QUICKSTART.md`、`docs/LLM_PROVIDERS.md`、`docs/CALCULATIONS.md`、`docs/CHANGES_SUMMARY.md`：使用说明/计算/变更记录。
- `prompts/*.md`：系统/市场/仓位提示词示例。

## 静态资源
- `public/icons/models/*.png`：模型图标资源。
- `public/icons/models/test.py`：占位脚本（不参与构建）。
