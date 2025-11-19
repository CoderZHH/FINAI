"use server";

import { loadSimConfig, saveSimConfig } from "../../../lib/simConfig.js";
import { hasOpenPositionsForSymbol } from "../../../lib/dataRepository.js";

export async function GET() {
  const config = loadSimConfig();
  return Response.json(config);
}

function normalizeMarginSymbols(payloadSymbols = {}) {
  const result = {};
  const validModes = new Set(["isolated", "cross"]);
  Object.entries(payloadSymbols).forEach(([key, value]) => {
    if (!value || typeof value !== "object") return;
    const upperKey = key.toUpperCase();
    const mode = typeof value.margin_mode === "string" ? value.margin_mode : "cross";
    if (!validModes.has(mode)) {
      throw new Error(`Invalid margin_mode "${mode}" for symbol ${key}`);
    }
    result[upperKey] = { margin_mode: mode };
  });
  return result;
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
    const current = loadSimConfig();
    const symbols = normalizeMarginSymbols(payload.symbols ?? current.symbols);
    const fees = normalizeFeeSection(payload.fees ?? current.fees);
    const funding = normalizeFunding(payload.funding ?? current.funding);

    const currentSymbols = normalizeMarginSymbols(current.symbols ?? {});
    for (const [symbol, cfg] of Object.entries(symbols)) {
      const prevMode = currentSymbols[symbol]?.margin_mode ?? "cross";
      if (prevMode === cfg.margin_mode) continue;
      const hasExposure = await hasOpenPositionsForSymbol(symbol);
      if (hasExposure) {
        throw new Error(`Symbol ${symbol} 有未平仓或挂单，禁止切换保证金模式。`);
      }
    }

    const merged = saveSimConfig({ symbols, fees, funding });
    return Response.json(merged);
  } catch (error) {
    console.error("[api/sim-config] update failed", error);
    return Response.json(
      { error: error?.message ?? "Failed to update sim config" },
      { status: 400 }
    );
  }
}
