# Vercel 上线前检查清单

## 1. 环境变量
- `POSTGRES_URL`（Neon 生产库连接串）
- `POSTGRES_SSL=true`
- `NEXT_PUBLIC_BASE_URL=https://<你的正式域名>`
- `BINANCE_*`（如果开启行情/交易流程）
- 各模型的 API Key（OpenAI/DeepSeek/Claude/Gemini/Grok）

## 2. 数据库初始化
- 确认目标库是空库。
- 设置：
  - `FINAI_ROOT_USERNAME=root`
  - `FINAI_ROOT_PASSWORD=<强密码>`
- 执行：`npm run db:init-empty`
- 用 root 登录验证一次后台。

## 3. 权限与可见性
- 访客模式：能看不能改。
- 普通用户：仅能访问自己的数据。
- 超级用户：可管理全量。
- 禁止保留弱口令 `root/root`。

## 4. Worker 对接
- Worker 平台配置：
  - `INTERNAL_API_BASE_URL=https://<你的正式域名>`
  - `POSTGRES_URL`、`POSTGRES_SSL=true`
- 启动命令：`npm run worker`

## 5. 发布前验证
- 本地执行：`npm run build`
- 部署后检查：
  - `/dashboard` 可访问
  - 游客进入 `/models`、`/settings` 只读
  - 登录后可新增/修改模型
  - Worker 日志无循环报错
