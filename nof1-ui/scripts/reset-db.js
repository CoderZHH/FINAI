/* eslint-disable no-console */
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnvFromFile } from "./utils/loadEnv.js";
import { logger } from "../lib/logManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PROMPTS_DIR = path.resolve(PROJECT_ROOT, "prompts");

const envFile = process.env.ENV_FILE ?? path.resolve(PROJECT_ROOT, ".env.local");
await loadEnvFromFile(envFile);
const LOG_MODULE = "reset-db";

async function importModule(relativePath) {
  const modulePath = path.join(__dirname, relativePath);
  return import(pathToFileURL(modulePath).href);
}

async function getPool() {
  const { getPool } = await importModule("../lib/db.js");
  return getPool();
}

async function loadPromptFile(filename) {
  const filePath = path.resolve(PROMPTS_DIR, filename);
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

async function seedDefaultPromptTemplate(pool) {
  const systemPrompt = await loadPromptFile("系统提示词.md");
  const userPrompt = await loadPromptFile("模板字符串.md");

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

  logger.info(LOG_MODULE, "默认提示词模板已确保存在。");
  return rows[0]?.id ?? null;
}

async function seedRiskLimits(pool) {
  // 不再预置分层，交由 Binance 同步或手动配置
  logger.info(LOG_MODULE, "risk_limits seeding skipped (no defaults).");
}

async function seedInsuranceFund(pool) {
  await pool.query(
    `
    INSERT INTO insurance_fund (id, balance)
    VALUES (1, 100000)
    ON CONFLICT (id) DO UPDATE
    SET balance = EXCLUDED.balance,
        updated_at = now()
    `
  );
  logger.info(LOG_MODULE, "insurance_fund seeded.");
}

async function seedSimSettings(pool) {
  const defaultFees = { default: { maker: 0.001, taker: 0.001 } };
  await pool.query(
    `
    INSERT INTO sim_settings (id, fees, updated_at)
    VALUES (1, $1, now())
    ON CONFLICT (id) DO UPDATE
    SET fees = EXCLUDED.fees,
        updated_at = now()
    `,
    [defaultFees]
  );
  logger.info(LOG_MODULE, "sim_settings seeded.");
}

async function dropExistingTables(pool) {
  const tables = [
    "risk_limits",
    "insurance_fund",
    "sim_settings",
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
      provider TEXT,
      llm_model TEXT,
      api_base_url TEXT,
      api_key TEXT,
      human_review_required BOOLEAN DEFAULT FALSE,
      prompt_template_id UUID REFERENCES prompt_templates(id) ON DELETE SET NULL,
      auto_run_enabled BOOLEAN DEFAULT FALSE,
      auto_run_interval_minutes INTEGER DEFAULT 5,
      last_auto_run_at TIMESTAMPTZ,
      next_auto_run_at TIMESTAMPTZ,
      display_icon TEXT DEFAULT 'icon:gpt',
      margin_config JSONB DEFAULT '{}'::jsonb,
      allowed_symbols TEXT[],
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE agent_accounts_runtime (
      model_id TEXT PRIMARY KEY REFERENCES agent_models(model_id) ON DELETE CASCADE,
      starting_equity NUMERIC(18,8) NOT NULL DEFAULT 10000,
      latest_equity NUMERIC(18,8) NOT NULL DEFAULT 10000,
      available_cash NUMERIC(18,8) NOT NULL DEFAULT 10000,
      total_unrealized_pnl NUMERIC(18,8) NOT NULL DEFAULT 0,
      wallet_balance NUMERIC(18,8) NOT NULL DEFAULT 10000,
      position_margin NUMERIC(18,8) NOT NULL DEFAULT 0,
      realized_pnl_price NUMERIC(18,8) DEFAULT 0,
      realized_pnl_fee NUMERIC(18,8) DEFAULT 0,
      realized_pnl_funding NUMERIC(18,8) DEFAULT 0,
      sharpe_ratio NUMERIC(18,8) DEFAULT 0,
      win_rate NUMERIC(18,8) DEFAULT 0,
      trade_count INTEGER DEFAULT 0,
      metadata JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
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
      reasoning_content TEXT,
      decision_blob JSONB,
      review_status TEXT NOT NULL DEFAULT 'logged',
      reviewed_at TIMESTAMPTZ,
      review_notes TEXT,
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
      mark_price NUMERIC(18,8),
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
    CREATE TABLE sim_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      fees JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now()
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
      realized_pnl_price NUMERIC(18,8),
      realized_pnl_fee NUMERIC(18,8),
      realized_pnl_funding NUMERIC(18,8),
      liquidation_price NUMERIC(18,8),
      liquidation_type TEXT,
      adl BOOLEAN DEFAULT FALSE,
      decision_source TEXT,
      take_profit NUMERIC(18,8),
      stop_loss NUMERIC(18,8),
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
      mark_price NUMERIC(18,8),
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

  await pool.query(`
    CREATE TABLE risk_limits (
      symbol TEXT NOT NULL,
      tier INTEGER NOT NULL,
      notional_cap NUMERIC(18,8) NOT NULL,
      max_leverage INTEGER NOT NULL,
      imr NUMERIC(18,8) NOT NULL,
      mmr NUMERIC(18,8) NOT NULL,
      PRIMARY KEY(symbol, tier)
    );
  `);

  await pool.query(`
    CREATE TABLE insurance_fund (
      id INTEGER PRIMARY KEY DEFAULT 1,
      balance NUMERIC(18,8) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function truncateTables(pool) {
  const tables = [
    "risk_limits",
    "insurance_fund",
    "sim_settings",
    "market_price_history",
    "agent_account_timeseries",
    "trades",
    "agent_accounts_runtime",
    "agent_logs",
    "market_prices",
    "agent_models",
    "prompt_templates",
  ];

  for (const table of tables) {
    await pool.query(`TRUNCATE ${table} RESTART IDENTITY CASCADE`);
  }
}

async function main() {
  logger.info(LOG_MODULE, "== Database reset ==");
  const pool = await getPool();

  try {
    logger.info(LOG_MODULE, "Rebuilding schema...");
    await ensureSchema(pool);

    logger.info(LOG_MODULE, "Truncating tables...");
    await truncateTables(pool);

    logger.info(LOG_MODULE, "Seeding default prompt template...");
    await seedDefaultPromptTemplate(pool);

    logger.info(LOG_MODULE, "Seeding risk limits...");
    await seedRiskLimits(pool);

    logger.info(LOG_MODULE, "Seeding insurance fund...");
    await seedInsuranceFund(pool);

    logger.info(LOG_MODULE, "Seeding sim settings...");
    await seedSimSettings(pool);

    logger.info(LOG_MODULE, "Database is now clean.");
  } finally {
    await pool.end();
  }
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch((err) => {
    console.error("Reset failed:", err);
    process.exitCode = 1;
  });
}
