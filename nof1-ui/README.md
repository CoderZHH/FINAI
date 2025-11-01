Alpha Arena Frontend
--------------------

本仓库是 Alpha Arena 前端 Demo，已经接入 **PostgreSQL 16**、**Redis (Windows 服务)** 与 **Binance 行情 API**。以下整理目前具备的功能、代码结构、运行方式以及如何操作持久层。

## 功能概览

| 功能 | 描述 | 关键 API / 数据层函数 |
| ---- | ---- | --------------------- |
| 行情概览 | 从 Redis 优先读取 24h ticker，缺失时回落 PostgreSQL；可通过脚本实时更新 | `/api/market/prices` → `getMarketSnapshot()` |
| 顶部 Ticker | 精简行情用于头部滚动条 | `/api/ticker` → `getTickerRows()` |
| 模型账户 / 排行榜 | 6 个模型 + 1 条基准线的权益、收益率、Sharpe、胜率、交易次数 | `/api/leaderboard`, `/api/models` → `getAgentAccounts()` |
| 权益曲线 | 拉取 `agent_equity_history` 生成 `$ / %` 可切换的折线图 | `/api/performance/timeseries`, `/api/chart` → `getPerformanceTimeseries()` |
| Since inception | 返回初始净值、起始时间等基础数据 | `/api/performance/since-inception` → `getSinceInceptionValues()` |
| 模型解释 | 显示最新模型自述、仓位摘要、风险提示 | `/api/agents/logs` → `getAgentLogs()` |
| 持仓概览 | 展示 6 个模型实时仓位，含未实现盈亏、退出计划 | `/api/positions/current` → `getPositionsSnapshot()` |
| 成交记录 / 历史查询 | 最近成交展示于右侧 feed；历史 Tab 支持分页 | `/api/trades`, `/api/trades/recent`, `/api/trades/history` → `getRecentTrades()`、`getTradesHistory()` |
| 决策确认 | 读取/修改 `pending_decisions`，写回确认状态 | `/api/decisions/pending`, `/api/decisions/confirm` |
| 提出交易 | 列出 6 种资产，提交批量申请至 `proposal_requests` | `/api/proposals/assets`, `/api/proposals/apply` |
| README Tab | 后端可返回实验协议及模式标签 | `/api/experiment/readme`、`/api/mode` |

所有 API 均使用 `lib/dataRepository.js` 中的仓储函数，数据库连接在 `lib/db.js`，Redis 连接在 `lib/redis.js`。

## 服务状况（Windows）

| 服务 | 安装路径 | 服务名 | 说明 |
| ---- | -------- | ------ | ---- |
| PostgreSQL 16 | `C:\Program Files\PostgreSQL\16` | `postgresql-x64-16` | 默认超级用户 `postgres` / 密码 `postgres`；业务库 `finai`，账号 `finai_user` / 密码 `finai_pass` |
| Redis (Redis-x64-5.0.14.1) | `C:\redis` | `Redis` | 目前未设置密码，如需可编辑 `redis.windows.conf` |

启动 / 停止示例：
```powershell
net start postgresql-x64-16
net stop postgresql-x64-16

net start Redis
net stop Redis
```

`.env.local`（已写入仓库）内容：
```
POSTGRES_URL=postgresql://finai_user:finai_pass@localhost:5432/finai
POSTGRES_SSL=false
REDIS_URL=redis://localhost:6379/0
BINANCE_BASE_URL=https://api.binance.com
BINANCE_SYMBOLS=["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","DOGEUSDT","XRPUSDT"]
```
可按需增加 `BINANCE_TIMEOUT_MS`、`REDIS_PRICE_TTL` 等参数。

## 初始脚本

1. **安装依赖**
   ```bash
   npm install
   ```

2. **写入演示数据** – 建表并灌入 6 个模型及基准线的权益曲线、持仓、日志、交易等；同时刷新 Redis 缓存。
   ```bash
   npm run seed:static
   ```

3. **抓取 Binance 行情** – 将最新 24h ticker 写入 PostgreSQL & Redis，默认缓存 TTL 120 秒。
   ```bash
   npm run fetch:prices
   ```
   如遇网络闪断，可重试；支持通过环境变量调整超时时间 `BINANCE_TIMEOUT_MS`。

4. **开发/生产**
   ```bash
   npm run dev        # 开发模式，http://localhost:3000
   npm run build      # 生成产物
   npm start          # 读取 .next 产物启动
   ```
   ⚠️ 以上命令需要 PostgreSQL 与 Redis 服务先启动，否则 API 会报错。

## 查看与管理数据

### PostgreSQL

```powershell
$env:PGPASSWORD='finai_pass'
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -h localhost -U finai_user -d finai -c "\dt"
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -h localhost -U finai_user -d finai -c "SELECT model_id, latest_equity FROM agent_accounts ORDER BY sort_order;"
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -h localhost -U finai_user -d finai -c "SELECT * FROM trades ORDER BY exit_time DESC LIMIT 5;"
```

### Redis

```powershell
C:\redis\redis-cli.exe --raw KEYS prices:*
C:\redis\redis-cli.exe --raw GET prices:BTCUSDT
```

## 前端数据来源说明

- 顶部行情条 / 市场快照：`market_prices` 表 + Redis `prices:<symbol>`。
- “TOTAL ACCOUNT VALUE” 图与图例：`agent_equity_history`、`agent_accounts`。
- 右侧 Tabs：
  - “成交记录” → `trades` 新近记录；
  - “决策确认” → `pending_decisions`；
  - “模型对话” → `agent_logs`；
  - “持仓概览” → `agent_positions` 结合 `agent_accounts`；
  - “提出交易” → `proposal_assets`（展示） + `proposal_requests`（存储提交）。

## 目录 & 关键文件

- `lib/db.js` / `lib/redis.js` – 管理数据库与缓存的连接池。
- `lib/dataRepository.js` – 汇总所有查询/写入逻辑，供 API 路由调用。
- `app/api/**/route.js` – 将 HTTP 请求映射到仓储函数，统一返回 JSON。
- `scripts/seed-static-data.js` – 建表、灌入演示数据。
- `scripts/fetch-prices.js` – 从 Binance 拉行情。
- `jsconfig.json` – 配置 `@/` 路径别名。
- `components/*` – 前端组件（ChartPanel、RightFeed 等）通过 SWR 持续请求上述 API。

## 常见问题

1. **只运行 `npm run dev` 就够了吗？**
   需要确保 `postgresql-x64-16` 和 `Redis` 服务已启动，否则 API 会报连接错误。

2. **如何刷新行情或重新种子数据？**
   - `npm run fetch:prices` – 更新行情（可定时运行）。
   - `npm run seed:static` – 重新初始化全部演示数据（会清空并覆盖）。

3. **Redis 要设置密码吗？**
   当前未设置，可在 `C:\redis\redis.windows.conf` 中编辑 `requirepass`，然后 `net stop Redis` / `net start Redis` 生效，同时更新 `.env.local`。

4. **如何扩展 API？**
   在 `lib/dataRepository.js` 新增仓储函数，然后在对应 `app/api/...` 路由调用，并确保数据库里有相应表和数据。

Tailwind v4 通过 `app/globals.css` 的 `@import "tailwindcss"` 使用，无需额外配置。
