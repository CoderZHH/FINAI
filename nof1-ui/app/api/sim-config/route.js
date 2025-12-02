"use server";

import { loadSimConfig, saveSimConfig } from "../../../lib/data/simConfig.js";
import { logger } from "@/lib/infrastructure/logManager";

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

export async function GET() {
  const config = await loadSimConfig();
  return Response.json(config);
}

export async function PUT(request) {
  try {
    const payload = await request.json();
    const current = await loadSimConfig();
    const fees = normalizeFeeSection(payload.fees ?? current.fees);
    const merged = await saveSimConfig({ fees });
    return Response.json(merged);
  } catch (error) {
    logger.error("api:sim-config", "模拟配置更新失败", { error: error?.message });
    return Response.json(
      { error: error?.message ?? "Failed to update sim config" },
      { status: 400 }
    );
  }
}
