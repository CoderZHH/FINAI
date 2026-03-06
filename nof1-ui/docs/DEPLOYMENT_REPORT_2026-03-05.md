# FINAI 部署复盘报告（2026-03-05）

## 1. 目标与范围
- 目标：将 FINAI 改造成可部署到 Vercel 的生产形态，并支持用户体系、游客只读与 PostgreSQL（Neon）数据存储。
- 范围：Web 端部署、数据库初始化、权限与只读控制、Worker 架构准备。

## 2. 业务目标确认（当前实现对齐）
- 主入口为官网页面。
- 支持注册/登录/退出。
- 支持“游客身份观看”。
- 设定超级用户 `root`（用于演示盘）。
- 游客可查看超级用户界面，但不可进行任何修改操作。
- 普通用户数据隔离（每个用户只看自己的大盘/模型/配置）。

## 3. 本次已完成改造

### 3.1 基础架构
- 移除 Redis 依赖，统一走 PostgreSQL。
- 保留 Web/API 在 Vercel，自动任务由独立 Worker 承担。

### 3.2 用户与权限
- 新增认证 API 与页面：
  - `/api/auth/login`、`/api/auth/register`、`/api/auth/logout`、`/api/auth/guest`、`/api/auth/me`
  - `/auth/login`、`/auth/register`、`/auth/guest`
- 中间件鉴权策略：
  - 未登录访问业务页面会跳转登录。
  - 游客可访问业务页面，但禁止写 API（非 GET/HEAD/OPTIONS）。
- 数据层实现按 `owner_user_id` 隔离。

### 3.3 游客只读覆盖
- `dashboard`：策略确认面板（批准/拒绝）禁写，JSON 编辑框只读。
- `models`：新增/编辑/删除/开关自动运行均禁用。
- `settings`：保存与同步操作禁用，输入框只读。
- `Header`：显示用户状态（游客或用户名）并支持退出。

### 3.4 数据库与初始化
- 新增空库安全初始化脚本：`npm run db:init-empty`
  - 仅在空库执行；
  - 检测到已有业务表会中止，避免误清库。
- `reset-db` 增强：
  - 支持 `FINAI_ROOT_USERNAME` / `FINAI_ROOT_PASSWORD` 注入 root 凭据。

### 3.5 文档
- 完成数据库部署文档与 Vercel 预部署清单文档。
- 新增本报告与 Worker 上线手册。

## 4. 部署执行结果（已完成）
- Vercel 项目已创建并可访问：
  - 正式域名：`https://nof1-ui.vercel.app`
- 生产部署已通过（含构建、静态页生成、函数打包）。
- Neon 数据库已完成初始化（建表 + 种子）。

## 5. 过程中处理的关键问题
- 问题：Vercel 构建报错 `BINANCE_API_BASE is required`
  - 处理：补齐 Vercel 环境变量（Development/Production）。
- 问题：Vercel 安全策略拦截 Next.js 漏洞版本
  - 处理：升级 `next` 到安全版本（当前 16.1.6）后重新部署成功。
- 问题：本地 `db:init-empty` 看似“无日志失败”
  - 原因：日志组件默认不输出终端；
  - 处理：改用直接调用脚本并验证 Neon 初始化成功。

## 6. 当前系统状态
- Web：已上线可访问。
- Auth：可用。
- 游客只读：核心页面已覆盖。
- 数据隔离：已接入。
- Worker：代码与启动入口已具备，但尚未上线到独立平台（见下一步）。

## 7. 剩余风险与建议
- 已在会话中暴露过 Vercel Token 与 Neon 连接串，必须立即轮换：
  1. 旋转 Neon 密码并更新 `POSTGRES_URL`。
  2. 删除并重建 Vercel Token。
- `root/root` 仅适合演示，生产必须改强口令。
- Worker 未上线时，自动调度逻辑不完整（核心业务链路不闭环）。

## 8. 下一步（最短路径）
1. 先完成凭据轮换（Neon + Vercel）。
2. 按 `WORKER_DEPLOY_GUIDE.md` 上线 Worker。
3. 部署后回归验证：
   - 游客只读有效；
   - 普通用户数据隔离有效；
   - Worker 日志正常轮询且无重复执行告警。
