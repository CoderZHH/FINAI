import { getPool } from "./db.js";

const DEFAULT_CONFIG = {
  fees: {
    default: { maker: 0.0002, taker: 0.0004 },
  },
  funding: {
    enabled: false,
    mode: "real", // or "fixed"
    fixed_rate: 0.0001,
  },
  risk_limits: [],
};

let cachedConfig = { ...DEFAULT_CONFIG };
let initialized = false;
const initPromise = initializeConfig();

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
    default: normalizeFeeEntry(rawFees.default ?? DEFAULT_CONFIG.fees.default, "default"),
  };
  Object.entries(rawFees).forEach(([key, value]) => {
    if (key === "default") return;
    normalized[key.toUpperCase()] = normalizeFeeEntry(value, key);
  });
  return normalized;
}

function normalizeFunding(rawFunding = {}) {
  const enabled = Boolean(rawFunding.enabled);
  const mode = rawFunding.mode === "fixed" ? "fixed" : "real";
  const fixedRate = Number(rawFunding.fixed_rate ?? DEFAULT_CONFIG.funding.fixed_rate);
  if (!Number.isFinite(fixedRate) || fixedRate < 0) {
    throw new Error("fixed_rate must be a non-negative number.");
  }
  return { enabled, mode, fixed_rate: fixedRate };
}

async function initializeConfig() {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `
      SELECT fees, funding
      FROM sim_settings
      WHERE id = 1
      `
    );
    if (rows.length) {
      cachedConfig = {
        fees: normalizeFees(rows[0].fees ?? {}),
        funding: normalizeFunding(rows[0].funding ?? {}),
      };
    } else {
      cachedConfig = { ...DEFAULT_CONFIG };
    }
  } catch (error) {
    console.warn("[simConfig] initialize from DB failed, using defaults", error?.message);
    cachedConfig = { ...DEFAULT_CONFIG };
  } finally {
    initialized = true;
  }
  return cachedConfig;
}

export async function loadSimConfig() {
  await initPromise;
  return cachedConfig;
}

export async function saveSimConfig(nextConfig = {}) {
  await initPromise;
  const fees = normalizeFees(nextConfig.fees ?? cachedConfig.fees ?? DEFAULT_CONFIG.fees);
  const funding = normalizeFunding(nextConfig.funding ?? cachedConfig.funding ?? DEFAULT_CONFIG.funding);
  const merged = { fees, funding };

  try {
    const pool = getPool();
    await pool.query(
      `
      INSERT INTO sim_settings (id, fees, funding, updated_at)
      VALUES (1, $1, $2, now())
      ON CONFLICT (id) DO UPDATE
      SET fees = EXCLUDED.fees, funding = EXCLUDED.funding, updated_at = now()
      `,
      [fees, funding]
    );
    cachedConfig = merged;
  } catch (error) {
    console.error("[simConfig] save failed", error);
    throw error;
  }

  return merged;
}

export function getFeeRate(symbol, liquidity) {
  const cfg = cachedConfig?.fees ?? DEFAULT_CONFIG.fees;
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
    DEFAULT_CONFIG.fees.default;
  if (liquidity === "maker") return Number(entry.maker ?? 0) || 0;
  if (liquidity === "taker") return Number(entry.taker ?? 0) || 0;
  throw new Error(`Invalid liquidity type "${liquidity}", expected maker/taker.`);
}

export function getFundingConfig() {
  return cachedConfig?.funding ?? { ...DEFAULT_CONFIG.funding };
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
  cachedConfig = await initializeConfig();
  return cachedConfig;
}
