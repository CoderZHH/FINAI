/* eslint-disable no-console */
const { Pool } = require("pg");
const Redis = require("ioredis");

if (!process.env.POSTGRES_URL) {
  console.error("POSTGRES_URL 未配置。请在 .env.local 中设置后再运行。");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false })
  : null;

const BASE_TS = new Date("2024-10-31T00:00:00Z").getTime();
const HOUR = 60 * 60 * 1000;

const MODELS = [
  { modelId: "gpt-5", name: "GPT 5", color: "#0ea5e9", sort: 1, metrics: { sharpe: 1.24, win: 0.63, trades: 128 } },
  { modelId: "claude-sonnet-4-5", name: "CLAUDE SONNET 4.5", color: "#f97316", sort: 2, metrics: { sharpe: 1.12, win: 0.61, trades: 112 } },
  { modelId: "gemini-2-5-pro", name: "GEMINI 2.5 PRO", color: "#2563eb", sort: 3, metrics: { sharpe: 1.03, win: 0.58, trades: 97 } },
  { modelId: "grok-4", name: "GROK 4", color: "#111827", sort: 4, metrics: { sharpe: 0.87, win: 0.55, trades: 88 } },
  { modelId: "deepseek-chat-v3-1", name: "DEEPSEEK CHAT v3.1", color: "#4338ca", sort: 5, metrics: { sharpe: 1.36, win: 0.69, trades: 156 } },
  { modelId: "qwen3-max", name: "QWEN3 MAX", color: "#7c3aed", sort: 6, metrics: { sharpe: 1.28, win: 0.66, trades: 141 } },
];

const BASELINE = {
  modelId: "btc-buy-hold",
  name: "BTC BUY&HOLD",
  color: "#0f172a",
  sort: 7,
  metrics: { sharpe: 0.64, win: 0.52, trades: 0 },
  isBaseline: true,
};

const SERIES_CONFIG = {
  "gpt-5": { drift: 22, amplitude: 120 },
  "claude-sonnet-4-5": { drift: 18, amplitude: 90 },
  "gemini-2-5-pro": { drift: 14, amplitude: 70 },
  "grok-4": { drift: 8, amplitude: 55 },
  "deepseek-chat-v3-1": { drift: 26, amplitude: 130 },
  "qwen3-max": { drift: 20, amplitude: 100 },
  "btc-buy-hold": { drift: 6, amplitude: 40 },
};

const COINS = [
  { symbol: "BTC", price: 109820.85, change: 1.82 },
  { symbol: "ETH", price: 3820.64, change: 1.12 },
  { symbol: "SOL", price: 182.3, change: 2.45 },
  { symbol: "BNB", price: 590.5, change: -0.84 },
  { symbol: "DOGE", price: 0.183, change: 0.91 },
  { symbol: "XRP", price: 2.48, change: 1.05 },
];

const POSITIONS = [
  {
    model_id: "gpt-5",
    symbol: "BTC",
    side: "LONG",
    leverage: 8,
    quantity: 0.85,
    notional: 93347.72,
    entry_price: 109000,
    mark_price: 109820.85,
    unrealized_pnl: 699.72,
    exit_plan: {
      profit_target: 112500,
      stop_loss: 103000,
      invalidation_condition: "若 4H 收盘跌破 EMA200 或波动率飙升。",
    },
  },
  {
    model_id: "claude-sonnet-4-5",
    symbol: "ETH",
    side: "SHORT",
    leverage: 4,
    quantity: 12,
    notional: 45000,
    entry_price: 3880,
    mark_price: 3820.64,
    unrealized_pnl: 711.68,
    exit_plan: {
      profit_target: 3600,
      stop_loss: 4050,
      invalidation_condition: "若宏观利空消退或链上资金净流入提升。",
    },
  },
  {
    model_id: "gemini-2-5-pro",
    symbol: "SOL",
    side: "LONG",
    leverage: 5,
    quantity: 110,
    notional: 20053,
    entry_price: 176,
    mark_price: 182.3,
    unrealized_pnl: 693,
    exit_plan: {
      profit_target: 205,
      stop_loss: 165,
      invalidation_condition: "若生态利好兑现失败或成交量萎缩。",
    },
  },
  {
    model_id: "grok-4",
    symbol: "BNB",
    side: "LONG",
    leverage: 3,
    quantity: 45,
    notional: 26572.5,
    entry_price: 580,
    mark_price: 590.5,
    unrealized_pnl: 472.5,
    exit_plan: {
      profit_target: 620,
      stop_loss: 555,
      invalidation_condition: "若交易所监管风险骤增。",
    },
  },
  {
    model_id: "deepseek-chat-v3-1",
    symbol: "DOGE",
    side: "LONG",
    leverage: 3,
    quantity: 18000,
    notional: 3294,
    entry_price: 0.174,
    mark_price: 0.183,
    unrealized_pnl: 162,
    exit_plan: {
      profit_target: 0.2,
      stop_loss: 0.16,
      invalidation_condition: "若社交媒体热度骤降或情绪指标低于 45。",
    },
  },
  {
    model_id: "qwen3-max",
    symbol: "XRP",
    side: "SHORT",
    leverage: 7,
    quantity: 3400,
    notional: 8432,
    entry_price: 2.61,
    mark_price: 2.48,
    unrealized_pnl: 442.8,
    exit_plan: {
      profit_target: 2.1,
      stop_loss: 2.6,
      invalidation_condition: "若政策风险缓和且价格重新站上 2.55。",
    },
  },
];

const AGENT_LOGS = [
  {
    model_id: "qwen3-max",
    timestamp: BASE_TS - 8 * 60 * 1000,
    public_message: "当前组合收益率约 +24%，维持 BTC 与 SOL 的多头仓位，关注 4 小时均线是否失守。",
    positions_summary: [
      {
        symbol: "BTC",
        side: "LONG",
        leverage: 8,
        thesis: "价格维持在 EMA200 之上，成交量放大支撑上涨趋势。",
        target: "112000",
        invalidation: "若 4H 收盘跌破 108000 立即减仓。",
      },
    ],
    risk_notes: "晚上有宏观数据发布，计划在前一小时降杠杆。",
  },
  {
    model_id: "claude-sonnet-4-5",
    timestamp: BASE_TS - 15 * 60 * 1000,
    public_message: "保持轻仓，主要负责风控与对冲，关注 XRP 空单回补节奏。",
    positions_summary: [
      {
        symbol: "XRP",
        side: "SHORT",
        leverage: 4,
        thesis: "监管事件可能压制短期情绪。",
        target: "2.10",
        invalidation: "若价格重回 2.55 以上立即止损。",
      },
    ],
    risk_notes: "若 BTC 突破 110k 将重新评估空头敞口。",
  },
];

const TRADES = [
  {
    model_id: "gpt-5",
    symbol: "BTC",
    side: "LONG",
    leverage: 6,
    quantity: 0.8,
    entry_price: 107200,
    exit_price: 109850,
    entry_time: new Date(BASE_TS - 12 * HOUR),
    exit_time: new Date(BASE_TS - 4 * HOUR),
    holding_time: "8 小时",
    realized_net_pnl: 2120.4,
    decision_source: "ai_auto",
  },
  {
    model_id: "claude-sonnet-4-5",
    symbol: "ETH",
    side: "SHORT",
    leverage: 4,
    quantity: 12,
    entry_price: 3880,
    exit_price: 3810,
    entry_time: new Date(BASE_TS - 36 * HOUR),
    exit_time: new Date(BASE_TS - 30 * HOUR),
    holding_time: "6 小时",
    realized_net_pnl: 840.12,
    decision_source: "ai_proposed_human_approved",
  },
  {
    model_id: "deepseek-chat-v3-1",
    symbol: "SOL",
    side: "LONG",
    leverage: 5,
    quantity: 120,
    entry_price: 176.5,
    exit_price: 184.1,
    entry_time: new Date(BASE_TS - 60 * HOUR),
    exit_time: new Date(BASE_TS - 48 * HOUR),
    holding_time: "12 小时",
    realized_net_pnl: 912.8,
    decision_source: "human_manual",
  },
];

const PENDING_DECISIONS = [
  {
    id: "pending-001",
    model_id: "gemini-2-5-pro",
    asset: "ETH",
    side: "LONG",
    target: 4050,
    stop_loss: 3700,
    size: 8,
    leverage: 5,
    comment: "计划在宏观数据公布前加仓 ETH，建议确认目标与止损。",
    timestamp: new Date(BASE_TS - 15 * 60 * 1000),
  },
  {
    id: "pending-002",
    model_id: "grok-4",
    asset: "BNB",
    side: "SHORT",
    target: 560,
    stop_loss: 610,
    size: 30,
    leverage: 3,
    comment: "对冲多头敞口，等待手动批准。",
    timestamp: new Date(BASE_TS - 25 * 60 * 1000),
  },
];

const PROPOSAL_ASSETS = [
  { symbol: "BTC", side: "LONG", leverage: 8, notional: 50000, stop_loss: 103000, notes: "主观 + AI 共识策略。" },
  { symbol: "ETH", side: "LONG", leverage: 5, notional: 20000, stop_loss: 3450, notes: "准备在宏观数据发布后进一步建仓。" },
  { symbol: "SOL", side: "LONG", leverage: 4, notional: 15000, stop_loss: 160, notes: "关注生态资金流与技术指标。" },
  { symbol: "BNB", side: "SHORT", leverage: 3, notional: 10000, stop_loss: 610, notes: "用于对冲集中度风险。" },
  { symbol: "DOGE", side: "LONG", leverage: 3, notional: 5000, stop_loss: 0.16, notes: "情绪驱动，保持轻仓。" },
  { symbol: "XRP", side: "SHORT", leverage: 6, notional: 8000, stop_loss: 2.6, notes: "监管事件未明朗前保持对冲头寸。" },
];

const READ_ME = {
  title: "Alpha Arena - 人机协同交易实验",
  mode_label: "LIVE · 协同模式",
  description_markdown: [
    "该实验平台展示多智能体与人工风控协同的交易流程，所有决策链路可追溯。",
    "此数据集为演示用静态样本，可通过脚本接入真实行情与策略输出。",
  ].join("\n\n"),
  rules_json: {
    starting_capital_usd: 10000,
    market_type: "crypto_perpetuals",
    objective: "风险收益兼顾",
    transparency: "所有模型决策与成交公开展示",
    autonomy: "AI 可提案，人工风控有最终裁决权",
    duration: {
      start_ts: new Date(BASE_TS - 72 * HOUR).toISOString(),
      end_ts: new Date(BASE_TS).toISOString(),
    },
    human_intervention_policy: "人工风控可修改杠杆、拒绝提案或强制平仓，所有动作记入审计日志。",
  },
};

function buildSeries(modelId) {
  const { drift, amplitude } = SERIES_CONFIG[modelId];
  let equity = 10000;
  return timeline().map((timestamp, index) => {
    const oscillation = Math.sin(index / 6 + 0.4) * amplitude;
    equity = Math.max(4000, equity + drift + oscillation);
    return {
      timestamp,
      dollar_equity: Number(equity.toFixed(2)),
      cum_pnl_pct: Number((equity / 10000 - 1).toFixed(4)),
    };
  });
}

function timeline() {
  return Array.from({ length: 72 }, (_, idx) => new Date(BASE_TS - (71 - idx) * HOUR));
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_prices (
      symbol TEXT PRIMARY KEY,
      price NUMERIC(18,8) NOT NULL,
      change_percent NUMERIC(10,4),
      high_price NUMERIC(18,8),
      low_price NUMERIC(18,8),
      volume NUMERIC(24,8),
      last_update_ts TIMESTAMP WITHOUT TIME ZONE,
      raw_payload JSONB,
      updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_accounts (
      model_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      latest_equity NUMERIC(18,2),
      pnl_pct NUMERIC(10,4),
      sharpe_ratio NUMERIC(10,4),
      win_rate NUMERIC(10,4),
      total_trades INTEGER,
      sort_order INTEGER,
      is_baseline BOOLEAN DEFAULT FALSE
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_since_inception (
      model_id TEXT PRIMARY KEY REFERENCES agent_accounts(model_id) ON DELETE CASCADE,
      nav_since_inception NUMERIC(18,2),
      inception_date TIMESTAMP WITHOUT TIME ZONE,
      num_invocations INTEGER,
      sort_order INTEGER
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_equity_history (
      model_id TEXT REFERENCES agent_accounts(model_id) ON DELETE CASCADE,
      timestamp TIMESTAMP WITHOUT TIME ZONE,
      dollar_equity NUMERIC(18,2),
      cum_pnl_pct NUMERIC(10,4),
      PRIMARY KEY (model_id, timestamp)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_positions (
      id BIGSERIAL PRIMARY KEY,
      model_id TEXT REFERENCES agent_accounts(model_id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      leverage NUMERIC(10,2),
      quantity NUMERIC(24,8),
      notional NUMERIC(24,8),
      entry_price NUMERIC(18,8),
      mark_price NUMERIC(18,8),
      unrealized_pnl NUMERIC(18,8),
      exit_plan JSONB
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_logs (
      id BIGSERIAL PRIMARY KEY,
      model_id TEXT REFERENCES agent_accounts(model_id) ON DELETE CASCADE,
      timestamp TIMESTAMP WITHOUT TIME ZONE NOT NULL,
      public_message TEXT,
      positions_summary JSONB,
      risk_notes TEXT,
      decision_json JSONB
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trades (
      id BIGSERIAL PRIMARY KEY,
      model_id TEXT REFERENCES agent_accounts(model_id) ON DELETE SET NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      leverage NUMERIC(10,2),
      quantity NUMERIC(24,8),
      entry_price NUMERIC(18,8),
      exit_price NUMERIC(18,8),
      entry_time TIMESTAMP WITHOUT TIME ZONE,
      exit_time TIMESTAMP WITHOUT TIME ZONE,
      holding_time TEXT,
      realized_net_pnl NUMERIC(18,8),
      decision_source TEXT,
      exit_plan JSONB
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pending_decisions (
      id TEXT PRIMARY KEY,
      model_id TEXT REFERENCES agent_accounts(model_id) ON DELETE SET NULL,
      asset TEXT,
      side TEXT,
      target NUMERIC(18,8),
      stop_loss NUMERIC(18,8),
      size NUMERIC(18,8),
      leverage NUMERIC(10,2),
      comment TEXT,
      status TEXT DEFAULT 'pending',
      timestamp TIMESTAMP WITHOUT TIME ZONE,
      confirmed_at TIMESTAMP WITHOUT TIME ZONE
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS proposal_assets (
      symbol TEXT PRIMARY KEY,
      side TEXT,
      leverage NUMERIC(10,2),
      notional NUMERIC(18,2),
      stop_loss NUMERIC(18,8),
      notes TEXT,
      sort_order INTEGER
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS proposal_requests (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT,
      side TEXT,
      leverage NUMERIC(10,2),
      notional NUMERIC(18,2),
      stop_loss NUMERIC(18,8),
      notes TEXT,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS experiment_readme (
      id BIGSERIAL PRIMARY KEY,
      version INTEGER,
      title TEXT,
      description_markdown TEXT,
      mode_label TEXT,
      rules_json JSONB,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now()
    );
  `);
}

async function truncateTables() {
  const tables = [
    "market_prices",
    "agent_equity_history",
    "agent_positions",
    "agent_logs",
    "trades",
    "pending_decisions",
    "proposal_assets",
    "proposal_requests",
    "experiment_readme",
    "agent_since_inception",
    "agent_accounts",
  ];
  for (const table of tables) {
    await pool.query(`TRUNCATE ${table} RESTART IDENTITY CASCADE`);
  }
}

async function seedMarketPrices() {
  for (const coin of COINS) {
    await pool.query(
      `
      INSERT INTO market_prices(symbol, price, change_percent, last_update_ts, raw_payload)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (symbol) DO UPDATE SET
        price = EXCLUDED.price,
        change_percent = EXCLUDED.change_percent,
        last_update_ts = EXCLUDED.last_update_ts,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now();
      `,
      [
        `${coin.symbol}USDT`,
        coin.price,
        coin.change,
        new Date(BASE_TS),
        { price: coin.price, change: coin.change },
      ]
    );

    if (redis) {
      await redis.set(
        `prices:${coin.symbol}USDT`,
        JSON.stringify({
          symbol: `${coin.symbol}USDT`,
          price: coin.price,
          changePercent: coin.change,
          lastUpdateTs: BASE_TS,
        }),
        "EX",
        30
      );
    }
  }
}

async function seedAccounts() {
  const allModels = [...MODELS, BASELINE];
  for (const meta of allModels) {
    const series = buildSeries(meta.modelId);
    const latestPoint = series.at(-1);
    await pool.query(
      `
      INSERT INTO agent_accounts(model_id, name, color, latest_equity, pnl_pct, sharpe_ratio, win_rate, total_trades, sort_order, is_baseline)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [
        meta.modelId,
        meta.name,
        meta.color,
        latestPoint.dollar_equity,
        latestPoint.cum_pnl_pct,
        meta.metrics.sharpe,
        meta.metrics.win,
        meta.metrics.trades,
        meta.sort,
        meta.isBaseline ?? false,
      ]
    );

    await pool.query(
      `
      INSERT INTO agent_since_inception(model_id, nav_since_inception, inception_date, num_invocations, sort_order)
      VALUES ($1,$2,$3,$4,$5)
      `,
      [meta.modelId, 10000, new Date(BASE_TS - 72 * HOUR), 0, meta.sort]
    );

    const values = [];
    const params = [];
    series.forEach((point, idx) => {
      const base = idx * 4;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
      params.push(meta.modelId, new Date(point.timestamp), point.dollar_equity, point.cum_pnl_pct);
    });

    await pool.query(
      `
      INSERT INTO agent_equity_history(model_id, timestamp, dollar_equity, cum_pnl_pct)
      VALUES ${values.join(", ")}
      ON CONFLICT (model_id, timestamp) DO UPDATE SET
        dollar_equity = EXCLUDED.dollar_equity,
        cum_pnl_pct = EXCLUDED.cum_pnl_pct
      `,
      params
    );
  }
}

async function seedPositions() {
  for (const pos of POSITIONS) {
    await pool.query(
      `
      INSERT INTO agent_positions(model_id, symbol, side, leverage, quantity, notional, entry_price, mark_price, unrealized_pnl, exit_plan)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
      `,
      [
        pos.model_id,
        pos.symbol,
        pos.side,
        pos.leverage,
        pos.quantity,
        pos.notional,
        pos.entry_price,
        pos.mark_price,
        pos.unrealized_pnl,
        JSON.stringify(pos.exit_plan),
      ]
    );
  }
}

async function seedLogs() {
  for (const log of AGENT_LOGS) {
    await pool.query(
      `
      INSERT INTO agent_logs(model_id, timestamp, public_message, positions_summary, risk_notes)
      VALUES ($1,$2,$3,$4::jsonb,$5)
      `,
      [
        log.model_id,
        new Date(log.timestamp),
        log.public_message,
        JSON.stringify(log.positions_summary),
        log.risk_notes,
      ]
    );
  }
}

async function seedTrades() {
  for (const trade of TRADES) {
    await pool.query(
      `
      INSERT INTO trades(model_id, symbol, side, leverage, quantity, entry_price, exit_price, entry_time, exit_time, holding_time, realized_net_pnl, decision_source)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      `,
      [
        trade.model_id,
        trade.symbol,
        trade.side,
        trade.leverage,
        trade.quantity,
        trade.entry_price,
        trade.exit_price,
        trade.entry_time,
        trade.exit_time,
        trade.holding_time,
        trade.realized_net_pnl,
        trade.decision_source,
      ]
    );
  }
}

async function seedPendingDecisions() {
  for (const decision of PENDING_DECISIONS) {
    await pool.query(
      `
      INSERT INTO pending_decisions(id, model_id, asset, side, target, stop_loss, size, leverage, comment, timestamp, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')
      `,
      [
        decision.id,
        decision.model_id,
        decision.asset,
        decision.side,
        decision.target,
        decision.stop_loss,
        decision.size,
        decision.leverage,
        decision.comment,
        decision.timestamp,
      ]
    );
  }
}

async function seedProposalAssets() {
  for (let index = 0; index < PROPOSAL_ASSETS.length; index += 1) {
    const asset = PROPOSAL_ASSETS[index];
    await pool.query(
      `
      INSERT INTO proposal_assets(symbol, side, leverage, notional, stop_loss, notes, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,
      [
        asset.symbol,
        asset.side,
        asset.leverage,
        asset.notional,
        asset.stop_loss,
        asset.notes,
        index + 1,
      ]
    );
  }
}

async function seedReadme() {
  await pool.query(
    `
    INSERT INTO experiment_readme(version, title, description_markdown, mode_label, rules_json)
    VALUES ($1,$2,$3,$4,$5)
    `,
    [1, READ_ME.title, READ_ME.description_markdown, READ_ME.mode_label, READ_ME.rules_json]
  );
}

async function main() {
  console.log("== 初始化数据库 ==");
  await ensureTables();
  await truncateTables();

  console.log("== 写入行情数据 ==");
  await seedMarketPrices();

  console.log("== 写入模型与曲线数据 ==");
  await seedAccounts();

  console.log("== 写入持仓、日志、交易等数据 ==");
  await seedPositions();
  await seedLogs();
  await seedTrades();
  await seedPendingDecisions();
  await seedProposalAssets();
  await seedReadme();

  console.log("数据写入完成。");
  if (redis) {
    console.log("Redis 缓存也已刷新。");
  } else {
    console.log("未配置 REDIS_URL，跳过 Redis 缓存刷新。");
  }
}

main()
  .catch((err) => {
    console.error("seed-static-data 执行失败：", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
    if (redis) {
      await redis.quit();
    }
  });
