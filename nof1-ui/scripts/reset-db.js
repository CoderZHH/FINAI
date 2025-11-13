/* eslint-disable no-console */
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");

async function importModule(relativePath) {
  const modulePath = path.join(__dirname, relativePath);
  return import(pathToFileURL(modulePath).href);
}

async function getPool() {
  const { getPool } = await importModule("../lib/db.js");
  return getPool();
}

const ROOT_DIR = path.resolve(__dirname, "..", "..");

const PLACEHOLDER_PRESETS = [
  {
    token: "minutes_since_start",
    label: "运行分钟数",
    description: "距离实验初始化所经过的分钟数，用于提醒模型运行总时长。",
    sample_value: "17802",
    category: "session",
  },
  {
    token: "current_time",
    label: "当前时间",
    description: "当前服务器时间（ISO 字符串）。",
    sample_value: "2025-11-03T21:51:04.603Z",
    category: "session",
  },
  {
    token: "num_invocations",
    label: "累计调用次数",
    description: "过去触发模型决策的累积次数。",
    sample_value: "6634",
    category: "session",
  },
  {
    token: "market_state_text",
    label: "市场状态摘要",
    description: "基于 market_price_history/market_prices 生成的多币种行情片段。",
    sample_value: "### ALL BTC DATA ...",
    category: "market",
  },
  {
    token: "sharpe_ratio",
    label: "夏普比率",
    description: "agent_accounts_runtime 中记录的最新夏普比率。",
    sample_value: "0.359",
    category: "performance",
  },
  {
    token: "position_state_text",
    label: "仓位状态摘要",
    description: "基于 agent_positions_runtime + agent_accounts_runtime 生成的仓位与账户描述。",
    sample_value: "Current Total Return (percent): -57.08% ...",
    category: "account",
  },
];

async function loadTextFromRoot(filename) {
  const filePath = path.resolve(ROOT_DIR, filename);
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content.trim();
  } catch (error) {
    console.warn(`[reset-db] 无法读取 ${filename}，使用空字符串。`, error.message);
    return "";
  }
}

function extractPlaceholderTokens(...payloads) {
  const regex = /\{([a-zA-Z0-9_]+)\}/g;
  const tokens = new Set();
  payloads
    .filter(Boolean)
    .forEach((text) => {
      let match = regex.exec(text);
      while (match) {
        tokens.add(match[1]);
        match = regex.exec(text);
      }
      regex.lastIndex = 0;
    });
  return Array.from(tokens);
}

async function seedPromptPlaceholders(pool) {
  for (const preset of PLACEHOLDER_PRESETS) {
    await pool.query(
      `
      INSERT INTO prompt_placeholders (token, label, description, sample_value, category)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (token) DO UPDATE
      SET
        label = EXCLUDED.label,
        description = EXCLUDED.description,
        sample_value = EXCLUDED.sample_value,
        category = EXCLUDED.category,
        updated_at = now()
      `,
      [
        preset.token,
        preset.label,
        preset.description,
        preset.sample_value,
        preset.category,
      ]
    );
  }
}

async function seedDefaultPromptTemplate(pool) {
  const systemPrompt = await loadTextFromRoot("系统提示词.md");
  const userPrompt = await loadTextFromRoot("模板字符串.md");

  if (!systemPrompt || !userPrompt) {
    console.warn("[reset-db] 默认提示词文件为空，跳过默认模板创建。");
    return null;
  }

  const placeholderTokens = extractPlaceholderTokens(systemPrompt, userPrompt);

  const { rows } = await pool.query(
    `
    INSERT INTO prompt_templates (
      template_name,
      description,
      system_prompt,
      user_prompt,
      placeholder_tokens,
      is_default
    )
    VALUES ($1,$2,$3,$4,$5::text[],TRUE)
    ON CONFLICT (template_name) DO UPDATE
    SET
      description = EXCLUDED.description,
      system_prompt = EXCLUDED.system_prompt,
      user_prompt = EXCLUDED.user_prompt,
      placeholder_tokens = EXCLUDED.placeholder_tokens,
      is_default = TRUE,
      updated_at = now()
    RETURNING id
    `,
    [
      "默认多因子策略模板",
      "来自模板字符串/系统提示词文件的默认组合。",
      systemPrompt,
      userPrompt,
      placeholderTokens,
    ]
  );

  console.log("[reset-db] 默认提示词模板已确保存在。");
  return rows[0]?.id ?? null;
}

async function seedPromptMetadata(pool) {
  await seedPromptPlaceholders(pool);
  await seedDefaultPromptTemplate(pool);
}

async function dropExistingTables(pool) {
  const tables = [
    "agent_positions_runtime",
    "pending_decisions",
    "agent_logs",
    "trades",
    "agent_account_timeseries",
    "market_price_history",
    "market_prices",
    "agent_accounts_runtime",
    "agent_models",
    "prompt_templates",
    "prompt_placeholders",
  ];

  for (const table of tables) {
    await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE;`);
  }
}

async function ensureSchema(pool) {
  await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
  await dropExistingTables(pool);

  await pool.query(`
    CREATE TABLE prompt_placeholders (
      token TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT,
      sample_value TEXT,
      category TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE prompt_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_name TEXT UNIQUE NOT NULL,
      description TEXT,
      system_prompt TEXT NOT NULL,
      user_prompt TEXT NOT NULL,
      placeholder_tokens TEXT[] DEFAULT '{}',
      sample_market_state_text TEXT,
      sample_position_state_text TEXT,
      is_default BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE agent_models (
      model_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      api_base_url TEXT,
      api_key TEXT,
      system_prompt TEXT,
      user_prompt TEXT,
      human_review_required BOOLEAN DEFAULT FALSE,
      prompt_template_id UUID REFERENCES prompt_templates(id) ON DELETE SET NULL,
      auto_run_enabled BOOLEAN DEFAULT FALSE,
      auto_run_interval_minutes INTEGER DEFAULT 5,
      last_auto_run_at TIMESTAMPTZ,
      next_auto_run_at TIMESTAMPTZ,
      display_icon TEXT DEFAULT 'icon:gpt',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE agent_accounts_runtime (
      model_id TEXT PRIMARY KEY REFERENCES agent_models(model_id) ON DELETE CASCADE,
      starting_equity NUMERIC(18,8) NOT NULL,
      latest_equity NUMERIC(18,8) NOT NULL,
      available_cash NUMERIC(18,8) NOT NULL,
      total_unrealized_pnl NUMERIC(18,8) NOT NULL,
      sharpe_ratio NUMERIC(18,8) DEFAULT 0,
      win_rate NUMERIC(18,8) DEFAULT 0,
      trade_count INTEGER DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE agent_positions_runtime (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_id TEXT REFERENCES agent_models(model_id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      leverage INTEGER DEFAULT 1,
      entry_price NUMERIC(18,8),
      current_price NUMERIC(18,8),
      quantity NUMERIC(18,8),
      notional NUMERIC(18,8),
      notional_usd NUMERIC(18,8),
      unrealized_pnl NUMERIC(18,8),
      take_profit NUMERIC(18,8),
      stop_loss NUMERIC(18,8),
      liquidation_price NUMERIC(18,8),
      sl_oid TEXT,
      tp_oid TEXT,
      entry_oid TEXT,
      confidence NUMERIC(10,6),
      risk_usd NUMERIC(18,8),
      wait_for_fill BOOLEAN DEFAULT FALSE,
      holding_seconds INTEGER DEFAULT 0,
      exit_plan JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX agent_positions_runtime_model_symbol_idx
    ON agent_positions_runtime(model_id, symbol);
  `);

  await pool.query(`
    CREATE TABLE pending_decisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_id TEXT REFERENCES agent_models(model_id) ON DELETE CASCADE,
      decision_blob JSONB NOT NULL,
      inserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      decision_type TEXT,
      target_symbol TEXT,
      auto_executed BOOLEAN DEFAULT FALSE
    );
  `);

  await pool.query(`
    CREATE INDEX pending_decisions_status_idx
    ON pending_decisions(status, inserted_at DESC);
  `);

  await pool.query(`
    CREATE TABLE agent_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_id TEXT REFERENCES agent_models(model_id) ON DELETE CASCADE,
      cycle_id INTEGER,
      public_message TEXT,
      cot_trace_summary TEXT,
      prompt_text TEXT,
      response_text TEXT,
      response_json JSONB,
      account_value_snapshot NUMERIC(18,8),
      sharpe_snapshot NUMERIC(18,8),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX agent_logs_model_created_idx
    ON agent_logs(model_id, created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE market_price_history (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      ts TIMESTAMPTZ NOT NULL,
      price_mid NUMERIC(18,8),
      ema20 NUMERIC(18,8),
      ema50 NUMERIC(18,8),
      macd NUMERIC(18,8),
      rsi_7 NUMERIC(18,8),
      rsi_14 NUMERIC(18,8),
      open_interest NUMERIC(18,8),
      open_interest_avg NUMERIC(18,8),
      funding_rate NUMERIC(18,8),
      volume NUMERIC(18,8),
      volume_avg NUMERIC(18,8),
      atr_3 NUMERIC(18,8),
      atr_14 NUMERIC(18,8),
      ema20_htf NUMERIC(18,8),
      ema50_htf NUMERIC(18,8),
      UNIQUE (symbol, timeframe, ts)
    );
  `);

  await pool.query(`
    CREATE TABLE agent_account_timeseries (
      id BIGSERIAL PRIMARY KEY,
      model_id TEXT REFERENCES agent_models(model_id) ON DELETE CASCADE,
      ts TIMESTAMPTZ NOT NULL DEFAULT now(),
      equity NUMERIC(18,8) NOT NULL,
      cash_available NUMERIC(18,8),
      unrealized_pnl NUMERIC(18,8),
      realized_pnl NUMERIC(18,8),
      sharpe NUMERIC(18,8),
      win_rate NUMERIC(18,8)
    );
  `);

  await pool.query(`
    CREATE INDEX agent_account_timeseries_model_ts_idx
    ON agent_account_timeseries(model_id, ts DESC);
  `);

  await pool.query(`
    CREATE TABLE trades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_id TEXT REFERENCES agent_models(model_id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity NUMERIC(18,8) NOT NULL,
      entry_price NUMERIC(18,8),
      exit_price NUMERIC(18,8),
      price NUMERIC(18,8),
      notional NUMERIC(18,8),
      notional_usd NUMERIC(18,8),
      leverage INTEGER,
      entry_time TIMESTAMPTZ,
      exit_time TIMESTAMPTZ,
      holding_time INTEGER,
      realized_net_pnl NUMERIC(18,8),
      decision_source TEXT,
      exit_plan JSONB,
      order_id TEXT,
      action TEXT,
      reason TEXT,
      cycle_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX trades_model_symbol_idx
    ON trades(model_id, symbol, created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE market_prices (
      symbol TEXT PRIMARY KEY,
      price NUMERIC(18,8) NOT NULL,
      change_percent NUMERIC(10,4),
      high_price NUMERIC(18,8),
      low_price NUMERIC(18,8),
      volume NUMERIC(24,8),
      volume_avg NUMERIC(24,8),
      ema20 NUMERIC(18,8),
      ema50 NUMERIC(18,8),
      macd NUMERIC(18,8),
      rsi_7 NUMERIC(18,8),
      rsi_14 NUMERIC(18,8),
      open_interest NUMERIC(18,8),
      open_interest_avg NUMERIC(18,8),
      funding_rate NUMERIC(18,8),
      atr_3 NUMERIC(18,8),
      atr_14 NUMERIC(18,8),
      ema20_htf NUMERIC(18,8),
      ema50_htf NUMERIC(18,8),
      macd_htf NUMERIC(18,8),
      rsi_14_htf NUMERIC(18,8),
      last_update_ts TIMESTAMPTZ,
      raw_payload JSONB,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}

async function truncateTables(pool) {
  const tables = [
    "market_price_history",
    "agent_account_timeseries",
    "trades",
    "agent_accounts_runtime",
    "agent_positions_runtime",
    "pending_decisions",
    "agent_logs",
    "market_prices",
    "agent_models",
    "prompt_templates",
    "prompt_placeholders",
  ];

  for (const table of tables) {
    await pool.query(`TRUNCATE ${table} RESTART IDENTITY CASCADE`);
  }
}

async function main() {
  console.log("== Database reset ==");
  const pool = await getPool();

  try {
    console.log("Rebuilding schema...");
    await ensureSchema(pool);

    console.log("Truncating tables...");
    await truncateTables(pool);

    console.log("Seeding prompt metadata...");
    await seedPromptMetadata(pool);

    console.log("Database is now clean.");
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Reset failed:", err);
    process.exitCode = 1;
  });
}
