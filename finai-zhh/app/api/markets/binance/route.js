export const preferredRegion = "sin1";

import { NextResponse } from "next/server";
import { logger } from "@/lib/infrastructure/logManager";
import { getPool } from "@/lib/infrastructure/db";

const CACHE_MS = 45_000;
const globalCache = globalThis.__binanceTickerCache ?? {
  key: "",
  data: null,
  ts: 0,
};
globalThis.__binanceTickerCache = globalCache;

export async function GET(request) {
  try {
    const pool = getPool();
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
      const orderBySql =
        sort === "percent"
          ? "COALESCE(change_percent, 0) DESC"
          : sort === "price"
            ? "COALESCE(price, 0) DESC"
            : "COALESCE(volume, 0) DESC";
      const qParam = q ? `%${q}%` : null;
      const { rows } = await pool.query(
        `
        SELECT
          symbol,
          price,
          NULLIF(to_jsonb(market_prices) ->> 'change_percent', '')::numeric AS change_percent,
          NULLIF(to_jsonb(market_prices) ->> 'high_price', '')::numeric AS high_price,
          NULLIF(to_jsonb(market_prices) ->> 'low_price', '')::numeric AS low_price,
          NULLIF(to_jsonb(market_prices) ->> 'volume', '')::numeric AS volume
        FROM market_prices
        WHERE symbol ~ 'USDT$'
          AND symbol !~ '(UP|DOWN|BEAR|BULL)USDT$'
          AND ($1::text IS NULL OR symbol ILIKE $1)
        ORDER BY ${orderBySql}
        LIMIT $2
        `,
        [qParam, limit]
      );
      tickers = rows.map((row) => {
        const symbol = String(row.symbol || "").toUpperCase();
        const base = symbol.replace(/USDT$/i, "");
        return {
          symbol,
          base,
          price: Number(row.price) || 0,
          changePercent: Number(row.change_percent) || 0,
          quoteVolume: Number(row.volume) || 0,
          highPrice: row.high_price == null ? null : Number(row.high_price),
          lowPrice: row.low_price == null ? null : Number(row.low_price),
          icon: `https://static.binance.us/assets/coins/${base}.svg`,
        };
      });
      globalCache.key = cacheKey;
      globalCache.data = tickers;
      globalCache.ts = now;
    }
    return NextResponse.json({
      tickers,
      source: "market_prices",
    });
  } catch (error) {
    logger.error("api:markets", "行情接口失败", { error: error?.message });
    return NextResponse.json(
      { error: error?.message ?? "行情数据获取失败" },
      { status: 502 }
    );
  }
}
