import { randomUUID } from "node:crypto";
import {
  createAgentModel,
  listAgentModels,
  loadAllModelAllowedSymbols,
  updateMarketPricesFromBinance,
} from "../../../lib/data/dataRepository";
import { importMarketData, syncLatestMarketData } from "../../../lib/market/marketImporter.js";
import { getLatestMarketHistoryTimestamp } from "../../../lib/data/dataRepository.js";
import { logger } from "@/lib/infrastructure/logManager";
import { requirePrincipal } from "../../../lib/auth/requestAuth.js";

function slugifyDisplayName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function generateModelId(displayName) {
  const slug = slugifyDisplayName(displayName);
  if (slug) {
    return `${slug}-${randomUUID().slice(0, 6)}`;
  }
  return `model-${randomUUID().slice(0, 8)}`;
}

function normalizeMarginConfigInput(input) {
  if (!input || typeof input !== "object") {
    return {};
  }
  return Object.entries(input).reduce((acc, [key, value]) => {
    const sym = String(key ?? "").trim().toUpperCase();
    if (!sym) return acc;
    acc[sym] = value === "isolated" ? "isolated" : "cross";
    return acc;
  }, {});
}

function normalizeAllowedSymbolsInput(input) {
  const list = Array.isArray(input) ? input : [];
  const cleaned = list
    .map((s) => String(s ?? "").trim().toUpperCase().replace(/USDT$/i, ""))
    .filter(Boolean);
  return Array.from(new Set(cleaned));
}

function compactModelResponse(model) {
  if (!model) return model;
  const allowed = new Set([
    "model_id",
    "display_name",
    "provider",
    "llm_model",
    "api_base_url",
    "display_icon",
    "margin_config",
    "allowed_symbols",
    "human_review_required",
    "prompt_template_id",
    "prompt_template",
    "auto_run_enabled",
    "auto_run_interval_minutes",
    "last_auto_run_at",
    "next_auto_run_at",
    "created_at",
    "updated_at",
    "has_api_key",
  ]);
  const result = {};
  Object.entries(model).forEach(([key, value]) => {
    if (!allowed.has(key)) return;
    if (value === null || value === undefined || value === "") return;
    result[key] = value;
  });
  if (model.prompt_template) {
    result.prompt_template = {
      id: model.prompt_template.id,
      name: model.prompt_template.name,
      placeholder_tokens: model.prompt_template.placeholder_tokens ?? [],
      is_default: Boolean(model.prompt_template.is_default),
    };
  }
  return result;
}

export async function GET(request) {
  const auth = await requirePrincipal(request, { allowGuest: true, requireWrite: false });
  if (!auth.ok) return auth.response;
  const principal = auth.principal;
  const url = new URL(request.url);
  const includeSecrets = url.searchParams.get("includeSecrets") === "true";
  const includeDisabled = url.searchParams.get("includeDisabled") !== "false";

  const models = await listAgentModels({
    includeDisabled,
    includeSecrets: includeSecrets && principal.kind !== "guest",
    ownerUserId: principal.userId,
  });

  return Response.json({ models: models.map(compactModelResponse) });
}

export async function POST(request) {
  const auth = await requirePrincipal(request, { allowGuest: true, requireWrite: true });
  if (!auth.ok) return auth.response;
  const principal = auth.principal;
  try {
    const payload = await request.json();
    const rawDisplayName =
      typeof payload?.display_name === "string" ? payload.display_name.trim() : "";
    if (!rawDisplayName) {
      return Response.json({ error: "display_name is required." }, { status: 400 });
    }
    const modelId = generateModelId(rawDisplayName);

    const cleanPayload = {
      model_id: modelId,
      display_name: rawDisplayName,
      api_base_url:
        typeof payload.api_base_url === "string"
          ? payload.api_base_url.trim() || null
          : null,
      provider:
        typeof payload.provider === "string" ? payload.provider.trim() || null : null,
      llm_model:
        typeof payload.llm_model === "string" ? payload.llm_model.trim() || null : null,
      api_key:
        typeof payload.api_key === "string"
          ? payload.api_key.trim() || null
          : null,
      human_review_required: Boolean(payload.human_review_required),
      prompt_template_id:
        typeof payload.prompt_template_id === "string" && payload.prompt_template_id.trim()
          ? payload.prompt_template_id.trim()
          : null,
      auto_run_enabled: Boolean(payload.auto_run_enabled),
      auto_run_interval_minutes:
        typeof payload.auto_run_interval_minutes === "number"
          ? payload.auto_run_interval_minutes
          : Number(payload.auto_run_interval_minutes) || 5,
      display_icon:
        typeof payload.display_icon === "string" ? payload.display_icon : undefined,
      margin_config: normalizeMarginConfigInput(payload.margin_config),
      allowed_symbols: normalizeAllowedSymbolsInput(payload.allowed_symbols),
      owner_user_id: principal.userId,
    };
    if (!cleanPayload.allowed_symbols.length) {
      return Response.json({ error: "allowed_symbols cannot be empty" }, { status: 400 });
    }

    const model = await createAgentModel(cleanPayload);
    // 冷启动：导入历史行情并同步风险/资金费（已有历史则只补增量）
    try {
      const symbols = cleanPayload.allowed_symbols;
      const symbolsNeedingFull = [];
      const symbolsNeedingSync = [];
      for (const sym of symbols) {
        const lastTs = await getLatestMarketHistoryTimestamp(sym, "1m");
        if (lastTs) {
          symbolsNeedingSync.push(sym);
        } else {
          symbolsNeedingFull.push(sym);
        }
      }
      if (symbolsNeedingFull.length) {
        await importMarketData(symbolsNeedingFull);
      }
      if (symbolsNeedingSync.length) {
        await syncLatestMarketData(symbolsNeedingSync);
      }
      const symbolParam = encodeURIComponent(cleanPayload.allowed_symbols.join(","));
      const internalBase =
        process.env.INTERNAL_API_BASE_URL ||
        process.env.NEXT_PUBLIC_BASE_URL ||
        new URL(request.url).origin;
      await fetch(`${internalBase}/api/binance/risk?symbols=${symbolParam}`, { method: "POST" });
      await fetch(`${internalBase}/api/binance/funding?symbols=${symbolParam}`, { method: "POST" });
    } catch (seedErr) {
      logger.warn("api:models", "冷启动行情/风险同步失败", { error: seedErr?.message });
    }
    await loadAllModelAllowedSymbols();
    // 尝试刷新行情以覆盖新符号
    updateMarketPricesFromBinance().catch(() => {});
    return Response.json({ model: compactModelResponse(model) });
  } catch (err) {
    logger.error("api:models", "创建模型失败", { error: err?.message });
    const message =
      err instanceof Error ? err.message : "Failed to create model";
    return Response.json({ error: message }, { status: 400 });
  }
}
