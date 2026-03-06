# FINAI Worker 上线手册（小白版）

## 1. 为什么必须有 Worker
- 你的项目核心“自动跑策略/同步行情/调度执行”在 `worker` 进程里。
- 只有 Web（Vercel）没有 Worker，页面可以看，但自动逻辑不会持续跑。

## 2. 推荐平台
- 推荐：Railway（步骤最少）。
- 备选：Render / Fly.io / 自己的云服务器。

## 3. 你需要准备什么
1. 一个 Railway 账号（GitHub 登录即可）。
2. 你的仓库已在 GitHub。
3. 可用的生产数据库连接串（Neon `POSTGRES_URL`）。

## 4. 在 Railway 上做什么（一步一步）

### 步骤 A：创建服务
1. 进入 Railway 控制台。
2. `New Project` -> `Deploy from GitHub repo`。
3. 选择你的 `FINAI` 仓库。
4. 服务名建议：`finai-worker`。

### 步骤 B：设置启动目录与命令
- Root Directory：`nof1-ui`
- Start Command：`npm run worker`

### 步骤 C：配置环境变量（必须）
- `POSTGRES_URL=<你的Neon生产连接串>`
- `POSTGRES_SSL=true`
- `INTERNAL_API_BASE_URL=https://nof1-ui.vercel.app`  
  （如果你后面改了正式域名，这里同步改）
- `NEXT_PUBLIC_BASE_URL=https://nof1-ui.vercel.app`
- `BINANCE_API_BASE=https://api.binance.com`
- `BINANCE_FAPI_BASE=https://fapi.binance.com`
- `AUTO_RUNNER_TICK_MS=5000`
- `MARKET_LOOP_INTERVAL_MS=5000`
- `AUTO_RUNNER_DISABLED=false`

说明：
- 如果你要实盘 Binance 私有接口，还需配置 `BINANCE_API_KEY/BINANCE_API_SECRET`。
- 如果只是先跑通流程，可先不配私钥（取决于你的策略是否强依赖私有端点）。

### 步骤 D：部署并观察日志
1. 点击 Deploy。
2. 查看 Logs，出现类似以下即正常：
   - `FINAI worker 启动中`
   - `FINAI worker 已启动 autoRunner`

## 5. 上线后你要验证的 5 件事
1. 打开 `https://nof1-ui.vercel.app` 页面正常。
2. 登录 root 后能看到数据面板。
3. 游客可看不可改（models/settings/decision 均只读）。
4. Worker 日志持续输出轮询行为，不崩溃重启。
5. 数据库里相关表（日志、行情、账户时间序列）有持续写入。

## 6. 常见问题

### Q1: Worker 一启动就退出
- 先检查 `POSTGRES_URL`、`POSTGRES_SSL`。
- 再检查 `INTERNAL_API_BASE_URL` 是否可访问。

### Q2: Web 正常，但没有自动更新
- 一般是 Worker 没启动或 `AUTO_RUNNER_DISABLED=true`。

### Q3: 出现重复执行
- 确保只启动一个 Worker 实例；如多实例，需明确并发策略。

## 7. 你现在要做什么（最短清单）
1. 去 Railway 创建 `finai-worker` 服务。
2. 按上面变量逐条粘贴。
3. 启动命令设为 `npm run worker`。
4. 发我 Railway 日志首屏，我帮你判断是否运行正常。
