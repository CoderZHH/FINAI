# Vercel + Worker 改造方案（方案 A）

## 目标
- Vercel 仅承载 Web/API 请求。
- 自动调度、行情循环、LLM 决策由独立 Worker 常驻进程承担。
- 去除 Redis 依赖，统一使用 PostgreSQL。

## 已落地改造
- Web 侧不再默认启动 autoRunner（`instrumentation.js` 仅在 `FINAI_AUTORUNNER_IN_WEB=true` 时启动）。
- 新增 `npm run worker` 与 `scripts/worker.js`，用于独立进程启动 autoRunner。
- 删除 Redis 代码路径与依赖（`ioredis`、`lib/infrastructure/redis.js`、`dataRepository` 中 Redis fallback）。
- `models` 路由内部 API 调用改为优先使用 `INTERNAL_API_BASE_URL`，其次 `NEXT_PUBLIC_BASE_URL`，最后回退当前请求域名。
- autoRunner 的 tick 间隔改为容错默认值（5000ms），避免模块导入时硬崩。
- autoRunner 增加 PostgreSQL advisory lock，避免多 worker 重复执行。
- 新增 `middleware.js` Basic Auth 保护（配置 `FINAI_BASIC_AUTH_USER/PASS` 后生效）。

## 生产部署拓扑
1. `finai-web`（Vercel）
   - 负责页面与 API。
   - 环境变量：`POSTGRES_URL`、`POSTGRES_SSL`、`BINANCE_*`、LLM 密钥等。
   - 建议额外配置：`FINAI_BASIC_AUTH_USER`、`FINAI_BASIC_AUTH_PASS`。
2. `finai-worker`（Railway/Fly/Render/VM 均可）
   - 启动命令：`npm run worker`
   - 必填环境变量：
     - `INTERNAL_API_BASE_URL=https://<your-vercel-domain>`
     - `POSTGRES_URL`、`POSTGRES_SSL`
     - `AUTO_RUNNER_TICK_MS`、`MARKET_LOOP_INTERVAL_MS`
     - `BINANCE_*`、LLM 密钥等

## 风险与治理
- 并发重复执行风险：建议补充数据库锁（advisory lock）或作业表（`jobs` + `SKIP LOCKED`）。
- 当前已接入 advisory lock；若未来扩展多类型任务，建议升级为作业表。
- SSE 多实例一致性：当前为内存流，建议转 DB 轮询或第三方实时通道。
- DB 连接数：Serverless + Worker 混合部署时，建议使用连接池代理（Neon/Supabase pooler/PgBouncer）。

## 后续建议
1. 为 Worker 增加健康检查与优雅退出信号处理（SIGTERM）。
2. 为 autoRunner 增加单次执行入口（`runMarketSyncOnce` / `runDispatchOnce`）以支持未来 Cron 化。
3. 在 CI 增加部署前检查：`npm run build` + 关键环境变量检测。
