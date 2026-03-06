import {
  deleteAgentModel,
  getAgentModelById,
  updateAgentModel,
} from "../../../../lib/data/dataRepository";
import {
  updateMarketPricesFromBinance,
  loadAllModelAllowedSymbols,
  getSymbolsMissingMarketHistory,
} from "../../../../lib/data/dataRepository";
import { isModelRunning } from "../../../../lib/trading/autoRunner";
import { logger } from "../../../../lib/infrastructure/logManager.js";
import { upsertRiskLimits } from "../../../../lib/data/simSettingsService.js";
import { getPool } from "../../../../lib/infrastructure/db.js";
import { importMarketData } from "../../../../lib/market/marketImporter.js";
import { requirePrincipal } from "../../../../lib/auth/requestAuth.js";

export const dynamic = "force-dynamic";

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

const BINANCE_FAPI_BASE = (() => {
  return process.env.BINANCE_FAPI_BASE || "https://fapi.binance.com";
})();
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;
let dispatcherReady = false;

function ensureMarketSymbol(symbol) {
  if (!symbol) return symbol;
  const upper = String(symbol).toUpperCase();
  return upper.endsWith("USDT") ? upper : `${upper}USDT`;
}

async function fetchJson(url) {
  if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
    throw new Error("BINANCE_API_KEY and BINANCE_API_SECRET are required for risk/funding sync.");
  }
  if (!dispatcherReady) {
    const proxyUrl =
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy;
    try {
      const { ProxyAgent, setGlobalDispatcher, fetch: undiciFetch } = await import("undici");
      if (proxyUrl) {
        setGlobalDispatcher(new ProxyAgent(proxyUrl));
        globalThis.__binanceFetch__ = undiciFetch;
      }
    } catch {
      // 允许无代理
    }
    dispatcherReady = true;
  }
  const fetchImpl = globalThis.__binanceFetch__ ?? fetch;
  const urlObj = new URL(url);
  urlObj.searchParams.set("timestamp", Date.now().toString());
  const qs = urlObj.searchParams.toString();
  const signature = (await import("node:crypto")).createHmac("sha256", BINANCE_API_SECRET)
    .update(qs)
    .digest("hex");
  urlObj.searchParams.set("signature", signature);

  const resp = await fetchImpl(urlObj.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0 (Model Save Risk/Funding Sync)",
      "X-MBX-APIKEY": BINANCE_API_KEY,
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Binance request failed ${resp.status}: ${text || url}`);
  }
  return resp.json();
}

async function syncRiskForSymbols(symbols = []) {
  const targets = symbols.map(ensureMarketSymbol);
  const limits = [];
  for (const symbol of targets) {
    try {
      const payload = await fetchJson(
        `${BINANCE_FAPI_BASE}/fapi/v1/leverageBracket?symbol=${symbol}`
      );
      const brackets = Array.isArray(payload)
        ? payload[0]?.brackets ?? []
        : payload?.brackets ?? [];
      brackets.forEach((b) => {
        const tier = Number(b.bracket ?? 0);
        if (!Number.isFinite(tier) || tier <= 0) return;
        const maxLev = Number(b.initialLeverage ?? 0);
        const notionalCap = Number(b.notionalCap ?? 0);
        const mmr = Number(b.maintMarginRatio ?? 0);
        if (!Number.isFinite(maxLev) || !Number.isFinite(notionalCap)) return;
        limits.push({
          symbol,
          tier,
          notional_cap: notionalCap,
          max_leverage: maxLev,
          imr: maxLev > 0 ? 1 / maxLev : 0,
          mmr: Number.isFinite(mmr) ? mmr : 0,
        });
      });
    } catch (error) {
      logger.warn("api/models", "sync risk failed", { symbol, error: error?.message });
    }
  }
  if (limits.length) {
    await upsertRiskLimits(limits);
  }
}

async function syncFundingForSymbols(symbols = []) {
  const targets = symbols.map(ensureMarketSymbol);
  if (!targets.length) return;
  const pool = getPool();
  for (const symbol of targets) {
    try {
      const payload = await fetchJson(
        `${BINANCE_FAPI_BASE}/fapi/v1/premiumIndex?symbol=${symbol}`
      );
      const rate = Number(payload.lastFundingRate ?? 0);
      if (!Number.isFinite(rate)) continue;
      const updated = await pool.query(
        `
        UPDATE market_prices
        SET funding_rate = $2, updated_at = now()
        WHERE symbol = $1
        `,
        [symbol, rate]
      );
      if (updated.rowCount === 0) {
        await pool.query(
          `
          INSERT INTO market_prices (
            symbol, price, change_percent, high_price, low_price, volume, funding_rate, last_update_ts, updated_at
          )
          VALUES ($1, 0, NULL, NULL, NULL, NULL, $2, now(), now())
          ON CONFLICT (symbol) DO UPDATE SET funding_rate = EXCLUDED.funding_rate, updated_at = now()
          `,
          [symbol, rate]
        );
      }
    } catch (error) {
      logger.warn("api/models", "sync funding failed", { symbol, error: error?.message });
    }
  }
}

async function getModelIdFromContext(context) {
  if (!context) return undefined;
  if ("params" in context) {
    const params = await context.params;
    return params?.modelId;
  }
  return undefined;
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

export async function GET(_request, context) {
  const auth = await requirePrincipal(_request, { allowGuest: true, requireWrite: false });
  if (!auth.ok) return auth.response;
  const principal = auth.principal;
  const modelId = await getModelIdFromContext(context);
  const model = await getAgentModelById(modelId, { ownerUserId: principal.userId });
  if (!model) {
    return Response.json({ error: "Model not found" }, { status: 404 });
  }
  return Response.json(
    { model: compactModelResponse(model) },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}

export async function PUT(request, context) {
  const auth = await requirePrincipal(request, { allowGuest: true, requireWrite: true });
  if (!auth.ok) return auth.response;
  const principal = auth.principal;
  const modelId = await getModelIdFromContext(context);
  try {
   
    const payload = await request.json();
   

    const currentModel = await getAgentModelById(modelId, { ownerUserId: principal.userId });
    if (!currentModel) {
      return Response.json({ error: "Model not found" }, { status: 404 });
    }
    const previousSymbols = Array.isArray(currentModel.allowed_symbols)
      ? currentModel.allowed_symbols.map((s) =>
          String(s ?? "").toUpperCase().replace(/USDT$/i, "")
        )
      : [];
    const updates = {};
    const payloadKeys = Object.keys(payload ?? {});
    const pauseOnly =
      payloadKeys.length === 1 &&
      Object.prototype.hasOwnProperty.call(payload, "auto_run_enabled") &&
      Boolean(payload.auto_run_enabled) === false;
    const running = isModelRunning(modelId) && Boolean(currentModel.auto_run_enabled);

    // 正在运行时必须先暂停
    if (running && !pauseOnly) {
      return Response.json(
        { error: "模型正在运行中，请先点击暂停后再修改配置。" },
        { status: 400 }
      );
    }
    // 自动运行开启状态下，不允许修改除“暂停”之外的内容
    if (currentModel.auto_run_enabled && !pauseOnly) {
      return Response.json(
        { error: "请先关闭自动运行再修改配置。" },
        { status: 400 }
      );
    }

    if (Object.prototype.hasOwnProperty.call(payload, "display_name")) {
      const displayName =
        typeof payload.display_name === "string"
          ? payload.display_name.trim()
          : "";
      if (!displayName) {
        throw new Error("display_name cannot be empty.");
      }
      updates.display_name = displayName;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "provider")) {
      updates.provider =
        typeof payload.provider === "string"
          ? payload.provider.trim() || null
          : null;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "llm_model")) {
      updates.llm_model =
        typeof payload.llm_model === "string"
          ? payload.llm_model.trim() || null
          : null;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "api_base_url")) {
      updates.api_base_url =
        typeof payload.api_base_url === "string"
          ? payload.api_base_url.trim() || null
          : null;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "api_key")) {
      if (payload.api_key === null) {
        updates.api_key = null;
      } else {
        updates.api_key =
          typeof payload.api_key === "string"
            ? payload.api_key.trim() || null
            : null;
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, "human_review_required")) {
      updates.human_review_required = Boolean(payload.human_review_required);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "prompt_template_id")) {
      if (payload.prompt_template_id === null) {
        updates.prompt_template_id = null;
      } else if (
        typeof payload.prompt_template_id === "string" &&
        payload.prompt_template_id.trim()
      ) {
        updates.prompt_template_id = payload.prompt_template_id.trim();
      } else {
        throw new Error("prompt_template_id must be null or a non-empty string.");
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, "auto_run_enabled")) {
      const desiredAutoRun = Boolean(payload.auto_run_enabled);
      const wasAutoRunEnabled = Boolean(currentModel.auto_run_enabled);
      updates.auto_run_enabled = desiredAutoRun;
      if (desiredAutoRun && !wasAutoRunEnabled) {
        updates.last_auto_run_at = null;
        updates.next_auto_run_at = null;
      }
      if (!desiredAutoRun) {
        updates.next_auto_run_at = null;
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, "display_icon")) {
      if (payload.display_icon === null) {
        updates.display_icon = null;
      } else if (typeof payload.display_icon === "string") {
        updates.display_icon = payload.display_icon;
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, "margin_config")) {
      updates.margin_config = normalizeMarginConfigInput(payload.margin_config);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "auto_run_interval_minutes")) {
      const interval = Number(payload.auto_run_interval_minutes);
      if (!Number.isFinite(interval) || interval < 1) {
        throw new Error("auto_run_interval_minutes must be a positive number.");
      }
      updates.auto_run_interval_minutes = Math.round(interval);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "allowed_symbols")) {
      updates.allowed_symbols = normalizeAllowedSymbolsInput(payload.allowed_symbols);
      if (!updates.allowed_symbols.length) {
        throw new Error("allowed_symbols cannot be empty.");
      }
    }

    const model = await updateAgentModel(modelId, updates, {
      ownerUserId: principal.userId,
    });
    // 如果新增了币种，只对“数据库尚无历史行情”的币执行导入与风险/资金费同步
    if (updates.allowed_symbols) {
      const previousSet = new Set(previousSymbols);
      const newSymbols = updates.allowed_symbols.filter((s) => !previousSet.has(s));
      if (newSymbols.length) {
        try {
          const symbolsToImport = await getSymbolsMissingMarketHistory(newSymbols, "1m");
          if (symbolsToImport.length) {
            await importMarketData(symbolsToImport);
            await syncRiskForSymbols(symbolsToImport);
            await syncFundingForSymbols(symbolsToImport);
          }
        } catch (syncErr) {
          logger.warn("api/models", "auto sync risk/funding failed", {
            error: syncErr?.message,
            symbols: newSymbols,
          });
        }
      }
    }
    await loadAllModelAllowedSymbols();
    updateMarketPricesFromBinance().catch(() => {});
    if (!model) {
      return Response.json({ error: "Model not found" }, { status: 404 });
    }
    const fresh = await getAgentModelById(modelId, {
      includeSecrets: false,
      ownerUserId: principal.userId,
    });
    const compact = compactModelResponse(fresh);
   
    return Response.json({ model: compact });
  } catch (err) {
    logger.error("api:models", "更新模型失败", {
      model_id: modelId,
      error: err?.message,
    });
    const message =
      err instanceof Error ? err.message : "Failed to update model";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request, context) {
  const auth = await requirePrincipal(_request, { allowGuest: true, requireWrite: true });
  if (!auth.ok) return auth.response;
  const principal = auth.principal;
  const modelId = await getModelIdFromContext(context);
  await deleteAgentModel(modelId, { ownerUserId: principal.userId });
  return Response.json({ ok: true });
}
