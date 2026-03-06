# 数据库上线方案（PostgreSQL）

## 结论
- 生产环境使用托管 PostgreSQL（推荐 Neon / Supabase / RDS）。
- Web（Vercel）与 Worker 使用同一个生产库连接串 `POSTGRES_URL`。
- 不要在生产执行 `node scripts/reset-db.js`（该脚本会删表重建）。

## 推荐流程
1. 创建独立生产库（与开发库完全隔离）。
2. 在 Vercel 与 Worker 平台分别配置：
   - `POSTGRES_URL`
   - `POSTGRES_SSL=true`（多数托管库需要）
3. 先在测试环境验证启动、读写、风控同步正常。
4. 上线后先观察连接数、慢 SQL、错误日志，再放开真实流量。

## Neon + Vercel 落地清单（建议按顺序）
1. 在 Neon 创建 3 个 DB 分支/库：`dev`、`staging`、`prod`。
2. 仅把 `prod` 连接串配置到正式 Vercel 项目；预览环境使用 `staging`。
3. 在 Vercel（Web）配置：
   - `POSTGRES_URL`
   - `POSTGRES_SSL=true`
   - `NEXT_PUBLIC_BASE_URL=https://<your-domain>`
4. 在 Worker 平台配置：
   - `POSTGRES_URL`、`POSTGRES_SSL=true`
   - `INTERNAL_API_BASE_URL=https://<your-domain>`
5. 首次初始化空库（仅空库执行）：
   - `FINAI_ROOT_USERNAME=root`
   - `FINAI_ROOT_PASSWORD=<强密码>`
   - 运行 `npm run db:init-empty`
6. 完成初始化后，登录后台验证：
   - `root` 账号可登录
   - 游客入口可查看但不能修改
7. 生产运行阶段禁止再次执行 `reset-db`（避免清库）。

## 初始化命令说明
- `npm run db:init-empty`
  - 先检查业务表是否存在；
  - 仅当数据库为空时才继续初始化；
  - 内部会执行 `reset-db` 完成建表与种子数据写入。
- `node scripts/reset-db.js`
  - 无空库检查，且会删表重建；
  - 仅限本地开发或你明确要重置的环境。

## 用户与可见性说明
- 项目上线后页面对互联网可访问，但业务页受登录/游客机制控制。
- 普通用户只能看和改自己的数据。
- 游客模式会进入超级用户视图，但是只读，写操作会在前后端双重拦截。
- 如果你保留默认 `root/root`，任何人都可能登录管理员账号，生产必须设置强密码。

## 迁移策略
- 当前项目没有正式 migration 框架，建议尽快引入（Prisma/Drizzle/Knex 任一）。
- 在 migration 到位前，生产首次初始化建议：
  - 从 `scripts/reset-db.js` 拆出“仅创建缺失表”的初始化脚本；
  - 禁止任何会 `DROP TABLE` 的逻辑进入生产流水线。

## 连接池建议
- Vercel + Worker 混合部署时，强烈建议开启数据库连接池代理（Neon pooler / PgBouncer）。
- 避免每个实例直连数据库导致连接数打满。
