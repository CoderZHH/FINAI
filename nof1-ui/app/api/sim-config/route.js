"use server";

import { loadSimConfig, saveSimConfig } from "../../../lib/simConfig.js";
import { listRiskLimits, upsertRiskLimits } from "../../../lib/simSettingsService.js";

function normalizeRiskLimits(raw = []) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const symbol = String(row.symbol ?? "").trim().toUpperCase();
      const tier = Number(row.tier ?? 0);
      const notional_cap = Number(row.notional_cap ?? 0);
      const max_leverage = Number(row.max_leverage ?? 0);
      const imr = Number(row.imr ?? 0);
      const mmr = Number(row.mmr ?? 0);
      if (!symbol || tier <= 0 || !Number.isFinite(tier)) return null;
      if (!Number.isFinite(notional_cap) || notional_cap <= 0) return null;
      if (!Number.isFinite(max_leverage) || max_leverage <= 0) return null;
      if (!Number.isFinite(imr) || imr <= 0) return null;
      if (!Number.isFinite(mmr) || mmr <= 0) return null;
      return { symbol, tier, notional_cap, max_leverage, imr, mmr };
    })
    .filter(Boolean);
}

export async function GET() {
  const config = await loadSimConfig();
  const risk_limits = await listRiskLimits();
  return Response.json({ ...config, risk_limits });
}

function normalizeFeeSection(rawFees = {}) {
  const normalizeEntry = (entry, label) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Fee entry for ${label} must be an object.`);
    }
    const maker = Number(entry.maker ?? 0);
    const taker = Number(entry.taker ?? 0);
    if (!Number.isFinite(maker) || maker < 0) {
      throw new Error(`Maker fee for ${label} must be a non-negative number.`);
    }
    if (!Number.isFinite(taker) || taker < 0) {
      throw new Error(`Taker fee for ${label} must be a non-negative number.`);
    }
    return { maker, taker };
  };

  const normalized = {
    default: normalizeEntry(rawFees.default ?? {}, "default"),
  };

  Object.entries(rawFees).forEach(([key, value]) => {
    if (key === "default") return;
    normalized[key.toUpperCase()] = normalizeEntry(value, key);
  });

  return normalized;
}

function normalizeFunding(rawFunding = {}) {
  const enabled = Boolean(rawFunding.enabled);
  const mode =
    rawFunding.mode === "fixed" || rawFunding.mode === "real"
      ? rawFunding.mode
      : "real";
  const fixedRate = Number(rawFunding.fixed_rate ?? 0.0001);
  if (!Number.isFinite(fixedRate) || fixedRate < 0) {
    throw new Error("fixed_rate must be a non-negative number.");
  }
  return {
    enabled,
    mode,
    fixed_rate: fixedRate,
  };
}

export async function PUT(request) {
  try {
    const payload = await request.json();
    const current = await loadSimConfig();
    const fees = normalizeFeeSection(payload.fees ?? current.fees);
    const funding = normalizeFunding(payload.funding ?? current.funding);

    const riskLimitsPayload = normalizeRiskLimits(payload.risk_limits);
    const merged = await saveSimConfig({ fees, funding });
    if (riskLimitsPayload.length) {
      await upsertRiskLimits(riskLimitsPayload);
    }
    const risk_limits = await listRiskLimits();
    return Response.json({ ...merged, risk_limits });
  } catch (error) {
    console.error("[api/sim-config] update failed", error);
    return Response.json(
      { error: error?.message ?? "Failed to update sim config" },
      { status: 400 }
    );
  }
}
