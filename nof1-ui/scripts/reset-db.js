/* eslint-disable no-console */
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function importModule(relativePath) {
  const modulePath = path.join(__dirname, relativePath);
  return import(pathToFileURL(modulePath).href);
}

async function getPool() {
  const { getPool } = await importModule("../lib/db.js");
  return getPool();
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
  ];

  for (const table of tables) {
    await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE;`);
  }
}

async function ensureSchema(pool) {
  await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
  await dropExistingTables(pool);

  await pool.query(`
    CREATE TABLE agent_models (
      model_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      api_base_url TEXT,
      api_key TEXT,
      system_prompt TEXT,
      user_prompt TEXT,
      human_review_required BOOLEAN DEFAULT FALSE,
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
      price NUMERIC(18,8) NOT NULL,
      notional_usd NUMERIC(18,8),
      leverage INTEGER,
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
