/* eslint-disable no-console */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFromFile } from "./utils/loadEnv.js";
import { logger } from "../lib/infrastructure/logManager.js";
import { main as runResetDb } from "./reset-db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const envFile = process.env.ENV_FILE ?? path.resolve(PROJECT_ROOT, ".env.local");
await loadEnvFromFile(envFile);

const LOG_MODULE = "init-empty-db";
const APP_TABLES = [
  "users",
  "user_sessions",
  "prompt_templates",
  "agent_models",
  "agent_accounts_runtime",
  "agent_logs",
  "trades",
  "market_prices",
  "market_price_history",
  "agent_account_timeseries",
  "risk_limits",
  "insurance_fund",
  "sim_settings",
  "pending_decisions",
];

async function getPool() {
  const { getPool } = await import("../lib/infrastructure/db.js");
  return getPool();
}

async function assertDatabaseEmpty(pool) {
  const { rows } = await pool.query(
    `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[])
    ORDER BY table_name
    `,
    [APP_TABLES]
  );

  if (rows.length > 0) {
    const existing = rows.map((row) => row.table_name).join(", ");
    throw new Error(
      `检测到非空业务库（已存在表: ${existing}）。为了避免误清库，init-empty-db 已停止。`
    );
  }
}

async function main() {
  logger.info(LOG_MODULE, "Checking database is empty before initialization...");
  const pool = await getPool();
  try {
    await assertDatabaseEmpty(pool);
  } finally {
    await pool.end();
  }

  logger.info(LOG_MODULE, "Database is empty. Running bootstrap reset-db...");
  await runResetDb();
  logger.info(LOG_MODULE, "Initialization completed.");
}

main().catch((error) => {
  logger.error(LOG_MODULE, "Initialization failed", { error: error?.message });
  process.exitCode = 1;
});
