import { getPool } from "./db.js";

function normalizeSymbol(symbol) {
  return String(symbol ?? "").trim().toUpperCase();
}

async function fetchTier(symbol, notional) {
  const pool = await getPool();
  const upperSymbol = normalizeSymbol(symbol);
  const notionalValue = Number(notional) || 0;

  const { rows } = await pool.query(
    `
    SELECT *
    FROM risk_limits
    WHERE symbol = $1 AND notional_cap >= $2
    ORDER BY tier ASC
    LIMIT 1
    `,
    [upperSymbol, notionalValue]
  );

  if (rows.length) {
    return rows[0];
  }

  const fallback = await pool.query(
    `
    SELECT *
    FROM risk_limits
    WHERE symbol = $1
    ORDER BY tier DESC
    LIMIT 1
    `,
    [upperSymbol]
  );

  return fallback.rows[0] ?? null;
}

export async function getRiskTier(symbol, notional) {
  return fetchTier(symbol, notional);
}

export async function getIMR(symbol, notional) {
  const tier = await fetchTier(symbol, notional);
  return tier ? Number(tier.imr ?? 0) : null;
}

export async function getMMR(symbol, notional) {
  const tier = await fetchTier(symbol, notional);
  return tier ? Number(tier.mmr ?? 0) : null;
}

export async function getMaxLeverage(symbol, notional) {
  const tier = await fetchTier(symbol, notional);
  return tier ? Number(tier.max_leverage ?? 0) : null;
}
