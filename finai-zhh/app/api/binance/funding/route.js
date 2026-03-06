"use server";

import { NextResponse } from "next/server";
import { loadAllModelAllowedSymbols, getTrackedSymbols } from "../../../../lib/data/dataRepository.js";
import { getPool } from "../../../../lib/infrastructure/db.js";
import { logger } from "../../../../lib/infrastructure/logManager.js";
import { ensureMarketSymbol } from "../../../../lib/market/symbols.js";
import crypto from "node:crypto";

const BINANCE_FAPI_BASE = (() => {
  const base = process.env.BINANCE_FAPI_BASE;
  if (!base) throw new Error("BINANCE_FAPI_BASE is required.");
  return base;
})();
const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;

let dispatcherConfigured = false;

function ensureApiEnv() {
  if (!API_KEY || !API_SECRET) {
    throw new Error("BINANCE_API_KEY and BINANCE_API_SECRET are required for funding sync.");
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
      const { ProxyAgent, setGlobalDispatcher, fetch: undiciFetch } = await import("undici");
      setGlobalDispatcher(new ProxyAgent(proxyUrl));
      globalThis.__binanceFetch__ = undiciFetch;
    } catch (err) {
      logger.warn("api/binance/funding", "proxy setup failed", { error: err?.message });
    }
  }
  dispatcherConfigured = true;
}

async function fetchJson(url) {
  ensureApiEnv();
  await configureProxy();
  const doFetch = async (useProxy) => {
    if (!useProxy) delete globalThis.__binanceFetch__;
    const fetchImpl = useProxy && globalThis.__binanceFetch__ ? globalThis.__binanceFetch__ : fetch;
    const urlObj = new URL(url);
    urlObj.searchParams.set("timestamp", Date.now().toString());
    const qs = urlObj.searchParams.toString();
    const signature = crypto.createHmac("sha256", API_SECRET).update(qs).digest("hex");
    urlObj.searchParams.set("signature", signature);
    const resp = await fetchImpl(urlObj.toString(), {
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
    if (String(error?.message || "").includes("fetch failed")) {
      logger.warn("api/binance/funding", "proxy fetch failed, retrying without proxy", {
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

async function fetchFundingRates(symbols = []) {
  const rates = {};
  for (const symbol of symbols) {
    try {
      const payload = await fetchJson(
        `${BINANCE_FAPI_BASE}/fapi/v1/premiumIndex?symbol=${symbol}`
      );
      const rate = Number(payload.lastFundingRate ?? 0);
      if (Number.isFinite(rate)) {
        rates[symbol] = rate;
      }
    } catch (error) {
      logger.warn("api/binance/funding", "funding failed", {
        symbol,
        error: error?.message,
      });
    }
  }
  return rates;
}

export async function GET() {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT symbol, funding_rate
    FROM market_prices
    WHERE funding_rate IS NOT NULL
    `
  );
  const funding_rates = rows.reduce((acc, row) => {
    acc[row.symbol] = Number(row.funding_rate);
    return acc;
  }, {});
  const symbols = Object.keys(funding_rates);
  return NextResponse.json({ symbols, funding_rates });
}

export async function POST(request) {
  const searchParams = request.nextUrl.searchParams;
  const symbols = await resolveSymbols(searchParams);
  const targets = symbols.map(ensureMarketSymbol);
  try {
    const rates = await fetchFundingRates(targets);
    const pool = getPool();
    for (const [symbol, rate] of Object.entries(rates)) {
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
    }
    return NextResponse.json({
      symbols: targets,
      funding_rates: rates,
    });
  } catch (error) {
    logger.warn("api/binance/funding", "sync failed", { error: error?.message });
    return NextResponse.json(
      { error: error?.message ?? "sync failed", symbols: targets },
      { status: 502 }
    );
  }
}
