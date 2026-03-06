export const preferredRegion = "sin1";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { logger } from "@/lib/infrastructure/logManager";

const CACHE_MS = 45_000;
const globalCache = globalThis.__binanceTickerCache ?? {
  key: "",
  data: null,
  ts: 0,
};
globalThis.__binanceTickerCache = globalCache;
const BINANCE_API_BASE = process.env.BINANCE_API_BASE ?? "https://api.binance.com";
const BINANCE_BASE_CANDIDATES = [
  "https://data-api.binance.vision",
  BINANCE_API_BASE,
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com",
  "https://api4.binance.com",
];

function mapTickerRow(t) {
  const symbol = String(t.symbol || "").toUpperCase();
  const base = symbol.replace(/USDT$/i, "");
  return {
    symbol,
    base,
    price: Number(t.lastPrice) || 0,
    changePercent: Number(t.priceChangePercent) || 0,
    quoteVolume: Number(t.quoteVolume ?? t.volume ?? 0) || 0,
    highPrice: t.highPrice == null ? null : Number(t.highPrice) || null,
    lowPrice: t.lowPrice == null ? null : Number(t.lowPrice) || null,
    icon: `https://static.binance.us/assets/coins/${base}.svg`,
  };
}

function filterUsdtCandidates(rows = [], q = "") {
  return rows
    .filter((t) => {
      const symbol = String(t.symbol || "").toUpperCase();
      if (!symbol.endsWith("USDT")) return false;
      if (/UP|DOWN|BEAR|BULL/i.test(symbol)) return false;
      if (!q) return true;
      const base = symbol.replace(/USDT$/i, "");
      return base.includes(q) || symbol.includes(q);
    })
    .map(mapTickerRow);
}

async function fetchCandidatesFromBinance() {
  let lastError = null;
  for (const baseUrl of BINANCE_BASE_CANDIDATES) {
    try {
      const resp = await fetch(`${baseUrl}/api/v3/ticker/24hr`, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": "finai-symbol-picker/1.0",
        },
      });
      if (!resp.ok) {
        lastError = new Error(`Binance API error ${resp.status}`);
        continue;
      }
      const data = await resp.json();
      if (!Array.isArray(data)) {
        lastError = new Error("Binance API payload is not an array");
        continue;
      }
      return data;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Binance API unavailable");
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim().toUpperCase() ?? "";
    const sort = url.searchParams.get("sort") ?? "volume"; // volume | percent | price
    const limitRaw = Number(url.searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 50;
    const cacheKey = `${q}::${sort}::${limit}`;

    const now = Date.now();
    let tickers =
      globalCache.data &&
      globalCache.key === cacheKey &&
      now - globalCache.ts < CACHE_MS
        ? globalCache.data
        : null;
    if (!tickers) {
      const rows = await fetchCandidatesFromBinance();
      const filtered = filterUsdtCandidates(rows, q);
      const sorted = filtered.sort((a, b) => {
        if (sort === "percent") return (b.changePercent ?? 0) - (a.changePercent ?? 0);
        if (sort === "price") return (b.price ?? 0) - (a.price ?? 0);
        return (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0);
      });
      tickers = sorted.slice(0, limit);
      globalCache.key = cacheKey;
      globalCache.data = tickers;
      globalCache.ts = now;
    }
    return NextResponse.json(
      {
        tickers,
        source: "binance_live_candidates",
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (error) {
    logger.error("api:markets", "候选币列表获取失败", { error: error?.message });
    return NextResponse.json(
      { error: error?.message ?? "候选币列表获取失败" },
      { status: 502 }
    );
  }
}
