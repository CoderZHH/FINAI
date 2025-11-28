"use server";

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { loadAllModelAllowedSymbols, getTrackedSymbols } from "../../../../lib/dataRepository.js";
import { listRiskLimits, upsertRiskLimits } from "../../../../lib/simSettingsService.js";
import { ensureMarketSymbol } from "../../../../lib/symbols.js";
import { logger } from "../../../../lib/logManager.js";

const BINANCE_USE_TESTNET =
  process.env.BINANCE_TESTNET === "true" || !!process.env.BINANCE_API_KEY_TEST;

const BINANCE_FAPI_BASE = (() => {
  if (BINANCE_USE_TESTNET) {
    return process.env.BINANCE_FAPI_BASE_TEST || "https://testnet.binancefuture.com";
  }
  const base = process.env.BINANCE_FAPI_BASE || "https://fapi.binance.com";
  return base;
})();
const API_KEY = BINANCE_USE_TESTNET
  ? process.env.BINANCE_API_KEY_TEST || process.env.BINANCE_API_KEY
  : process.env.BINANCE_API_KEY;
const API_SECRET = BINANCE_USE_TESTNET
  ? process.env.BINANCE_API_SECRET_TEST || process.env.BINANCE_API_SECRET
  : process.env.BINANCE_API_SECRET;

let dispatcherConfigured = false;
let proxyAgent = null;

function ensureApiEnv() {
  if (!API_KEY || !API_SECRET) {
    throw new Error("BINANCE_API_KEY and BINANCE_API_SECRET are required for risk sync.");
  }
}

async function configureProxy() {
  if (dispatcherConfigured) return;
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (proxyUrl) {
    try {
      const { ProxyAgent } = await import("undici");
      proxyAgent = new ProxyAgent(proxyUrl);
      logger.info("api/binance/risk", "Proxy enabled", { proxy: proxyUrl });
    } catch (err) {
      logger.warn("api/binance/risk", "proxy setup failed", { error: err?.message });
    }
  }
  dispatcherConfigured = true;
}

async function fetchJson(url) {
  ensureApiEnv();
  await configureProxy();
  const doFetch = async (useProxy) => {
    const urlObj = new URL(url);
    urlObj.searchParams.set("timestamp", Date.now().toString());
    const qs = urlObj.searchParams.toString();
    const signature = crypto.createHmac("sha256", API_SECRET).update(qs).digest("hex");
    urlObj.searchParams.set("signature", signature);
    const resp = await fetch(urlObj.toString(), {
      dispatcher: useProxy && proxyAgent ? proxyAgent : undefined,
      headers: {
        "User-Agent": "Mozilla/5.0 (Binance Sync)",
        "X-MBX-APIKEY": API_KEY,
      },
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Binance request failed ${resp.status}: ${text || url}`);
    }
    return resp.json();
  };
  try {
    return await doFetch(true);
  } catch (error) {
    // 如果代理失败，尝试不使用代理再试一次
    if (String(error?.message || "").includes("fetch failed")) {
      logger.warn("api/binance/risk", "proxy fetch failed, retrying without proxy", {
        error: error?.message,
      });
      return await doFetch(false);
    }
    throw error;
  }
}

async function resolveSymbols(searchParams) {
  const qp = searchParams.get("symbols");
  if (qp) {
    return qp
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  await loadAllModelAllowedSymbols();
  return getTrackedSymbols();
}

async function fetchLeverageBrackets(symbols = []) {
  const results = [];
  const errors = [];
  for (const symbol of symbols) {
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
        results.push({
          symbol,
          tier,
          notional_cap: notionalCap,
          max_leverage: maxLev,
          imr: maxLev > 0 ? 1 / maxLev : 0,
          mmr: Number.isFinite(mmr) ? mmr : 0,
        });
      });
    } catch (error) {
      logger.warn("api/binance/risk", "leverageBracket failed", {
        symbol,
        error: error?.message,
      });
      errors.push({ symbol, error: error?.message });
    }
  }
  return { results, errors };
}

export async function GET() {
  const risk_limits = await listRiskLimits();
  await loadAllModelAllowedSymbols();
  const symbols = getTrackedSymbols();
  return NextResponse.json({ symbols, risk_limits });
}

export async function POST(request) {
  const searchParams = request.nextUrl.searchParams;
  const symbols = await resolveSymbols(searchParams);
  const targets = symbols.map(ensureMarketSymbol);
  try {
    const { results, errors } = await fetchLeverageBrackets(targets);
    if (results.length) {
      await upsertRiskLimits(results);
    }
    const stored = await listRiskLimits();
    return NextResponse.json({
      symbols: targets,
      risk_limits: stored,
      errors,
    });
  } catch (error) {
    logger.warn("api/binance/risk", "sync failed", { error: error?.message });
    return NextResponse.json(
      { error: error?.message ?? "sync failed", symbols: targets },
      { status: 502 }
    );
  }
}
