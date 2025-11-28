import { getPool } from "./db.js";

const DEFAULT_FEES = { default: { maker: 0.001, taker: 0.001 } };

let cachedFees = { ...DEFAULT_FEES };
let initialized = false;
const initPromise = initialize();

async function initialize() {
  try {
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sim_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        fees JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    const { rows } = await pool.query(
      `
      SELECT fees
      FROM sim_settings
      WHERE id = 1
      `
    );
    if (rows.length) {
      cachedFees = normalizeFees(rows[0].fees);
    } else {
      await pool.query(
        `
        INSERT INTO sim_settings (id, fees, updated_at)
        VALUES (1, $1, now())
        ON CONFLICT (id) DO UPDATE SET fees = EXCLUDED.fees, updated_at = now()
        `,
        [DEFAULT_FEES]
      );
      cachedFees = { ...DEFAULT_FEES };
    }
  } catch (error) {
    console.error("[simConfig] init failed", error);
    cachedFees = { ...DEFAULT_FEES };
  } finally {
    initialized = true;
  }
  return cachedFees;
}

function normalizeFeeEntry(entry = {}, label = "default") {
  const maker = Number(entry.maker ?? 0);
  const taker = Number(entry.taker ?? 0);
  if (!Number.isFinite(maker) || maker < 0) {
    throw new Error(`Maker fee for ${label} must be a non-negative number.`);
  }
  if (!Number.isFinite(taker) || taker < 0) {
    throw new Error(`Taker fee for ${label} must be a non-negative number.`);
  }
  return { maker, taker };
}

function normalizeFees(rawFees = {}) {
  const normalized = {
    default: normalizeFeeEntry(rawFees.default ?? DEFAULT_FEES.default, "default"),
  };
  Object.entries(rawFees).forEach(([key, value]) => {
    if (key === "default") return;
    normalized[key.toUpperCase()] = normalizeFeeEntry(value, key);
  });
  return normalized;
}

export async function loadSimConfig() {
  await initPromise;
  return { fees: cachedFees };
}

export async function saveSimConfig(nextConfig = {}) {
  await initPromise;
  const fees = normalizeFees(nextConfig.fees ?? cachedFees ?? DEFAULT_FEES);
  try {
    const pool = getPool();
    await pool.query(
      `
      INSERT INTO sim_settings (id, fees, updated_at)
      VALUES (1, $1, now())
      ON CONFLICT (id) DO UPDATE
      SET fees = EXCLUDED.fees, updated_at = now()
      `,
      [fees]
    );
    cachedFees = fees;
  } catch (error) {
    console.error("[simConfig] save failed", error);
    throw error;
  }
  return { fees };
}

export function getFeeRate(symbol, liquidity) {
  const cfg = cachedFees ?? DEFAULT_FEES;
  const candidates = [];
  if (symbol) {
    const upper = String(symbol).toUpperCase();
    candidates.push(upper);
    if (!upper.endsWith("USDT")) {
      candidates.push(`${upper}USDT`);
    }
  }
  const entry =
    candidates.map((key) => cfg[key]).find(Boolean) ??
    cfg.default ??
    DEFAULT_FEES.default;
  if (liquidity === "maker") return Number(entry.maker ?? 0) || 0;
  if (liquidity === "taker") return Number(entry.taker ?? 0) || 0;
  throw new Error(`Invalid liquidity type "${liquidity}", expected maker/taker.`);
}

export function getMarginModeForModel(modelConfig, symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  const cfg = modelConfig?.margin_config ?? {};
  const mode = cfg[sym];
  if (mode === "isolated" || mode === "cross") {
    return mode;
  }
  return "cross";
}

export async function refreshSimConfig() {
  cachedFees = (await initialize()) ?? DEFAULT_FEES;
  return { fees: cachedFees };
}
