"use server";

export const preferredRegion = "sin1";

import { NextResponse } from "next/server";
import { logger } from "@/lib/infrastructure/logManager";

const BINANCE_API_BASE = process.env.BINANCE_API_BASE ?? "https://api.binance.com";
const BINANCE_BASE_CANDIDATES = [
  BINANCE_API_BASE,
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com",
  "https://api4.binance.com",
  "https://data-api.binance.vision",
].filter(Boolean);

const CACHE_KEY = "binance_24h_tickers";
const CACHE_MS = 45_000;
const globalCache = globalThis.__binanceTickerCache ?? {
  data: null,
  ts: 0,
};
globalThis.__binanceTickerCache = globalCache;

async function fetch24hTickersFromBinance() {
  let lastStatus = null;
  let lastError = null;

  for (const base of BINANCE_BASE_CANDIDATES) {
    try {
      const res = await fetch(`${base}/api/v3/ticker/24hr`, {
        cache: "no-store",
        headers: {
          "User-Agent": "finai-markets/1.0",
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        lastStatus = res.status;
        continue;
      }

      const data = await res.json();
      if (!Array.isArray(data)) {
        lastStatus = 502;
        continue;
      }
      return data;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw new Error(`Binance request failed: ${lastError.message || "unknown error"}`);
  }
  throw new Error(`Binance API error ${lastStatus ?? "unknown"}`);
}

function filterAndMapTickers(tickers) {
  return tickers
    .filter((t) => {
      const sym = String(t.symbol || "").toUpperCase();
      if (!sym.endsWith("USDT")) return false;
      if (/UP|DOWN|BEAR|BULL/.test(sym)) return false;
      return true;
    })
    .map((t) => {
      const base = t.symbol.replace(/USDT$/i, "");
      return {
        symbol: t.symbol,
        base,
        price: Number(t.lastPrice) || 0,
        changePercent: Number(t.priceChangePercent) || 0,
        quoteVolume: Number(t.quoteVolume ?? t.volume ?? 0) || 0,
        highPrice: Number(t.highPrice) || null,
        lowPrice: Number(t.lowPrice) || null,
        icon: `https://static.binance.us/assets/coins/${base}.svg`,
      };
    });
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim().toUpperCase() ?? "";
    const sort = url.searchParams.get("sort") ?? "volume"; // volume | percent | price
    const limit = Number(url.searchParams.get("limit") ?? 50);

    const now = Date.now();
    let tickers =
      globalCache.data && now - globalCache.ts < CACHE_MS ? globalCache.data : null;
    if (!tickers) {
      const data = await fetch24hTickersFromBinance();
      tickers = filterAndMapTickers(Array.isArray(data) ? data : []);
      globalCache.data = tickers;
      globalCache.ts = now;
    }

    let filtered = tickers;
    if (q) {
      filtered = tickers.filter((t) => t.base.includes(q) || t.symbol.includes(q));
    }

    const sorted = [...filtered].sort((a, b) => {
      if (sort === "percent") return (b.changePercent ?? 0) - (a.changePercent ?? 0);
      if (sort === "price") return (b.price ?? 0) - (a.price ?? 0);
      return (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0);
    });

    const limited = Number.isFinite(limit) && limit > 0 ? sorted.slice(0, limit) : sorted;
    return NextResponse.json({ tickers: limited });
  } catch (error) {
    logger.error("api:markets", "Binance 行情接口失败", { error: error?.message });
    return NextResponse.json(
      { error: error?.message ?? "Binance 数据获取失败，无数据返回" },
      { status: 502 }
    );
  }
}
