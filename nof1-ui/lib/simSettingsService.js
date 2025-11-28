import { getPool } from "./db.js";
import { logger } from "./logManager.js";

export async function listRiskLimits() {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT symbol, tier, notional_cap, max_leverage, imr, mmr
    FROM risk_limits
    ORDER BY symbol, tier
    `
  );
  return rows;
}

export async function upsertRiskLimits(entries = []) {
  if (!Array.isArray(entries)) {
    throw new Error("entries must be an array");
  }
  const pool = getPool();
  const normalizeSymbol = (symbol = "") => {
    const upper = String(symbol ?? "").trim().toUpperCase();
    return upper.endsWith("USDT") ? upper : `${upper}USDT`;
  };
  for (const entry of entries) {
    const { symbol, tier, notional_cap, max_leverage, imr, mmr } = entry ?? {};
    if (!symbol || !tier) continue;
    await pool.query(
      `
      INSERT INTO risk_limits (symbol, tier, notional_cap, max_leverage, imr, mmr)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (symbol, tier) DO UPDATE
      SET notional_cap = EXCLUDED.notional_cap,
          max_leverage = EXCLUDED.max_leverage,
          imr = EXCLUDED.imr,
          mmr = EXCLUDED.mmr
      `,
      [
        normalizeSymbol(symbol),
        Number(tier),
        Number(notional_cap),
        Number(max_leverage),
        Number(imr),
        Number(mmr),
      ]
    );
  }
  logger.info("simSettings", "risk_limits updated", { count: entries.length });
  return listRiskLimits();
}
