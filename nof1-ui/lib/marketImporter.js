"use server";

import { EMA, MACD, RSI, ATR, SMA } from "technicalindicators";
import { logger } from "./logManager.js";
import { ensureMarketSymbol } from "./symbols.js";
import {
  insertMarketPriceSnapshot,
  upsertMarketPrice,
  getLatestMarketHistoryTimestamp,
} from "./dataRepository.js";

const LOG_MODULE = "marketImporter";
const BINANCE_FAPI_BASE = (() => {
  const base = process.env.BINANCE_FAPI_BASE;
  if (!base) throw new Error("BINANCE_FAPI_BASE is required for market import.");
  return base;
})();

const TIMEFRAME_MIN = "1m";
const TIMEFRAME_HTF = "4h";
const INTERVAL_MS = {
  [TIMEFRAME_MIN]: 60_000,
  [TIMEFRAME_HTF]: 4 * 60 * 60 * 1000,
};
const MAX_KLINE_LIMIT = 1500;
const MAX_RETRY = Number(process.env.GET_MARKET_RETRY ?? 3);
const DEFAULT_LOOKBACK_DAYS = Number(process.env.GET_MARKET_LOOKBACK_DAYS ?? 3);
const DEFAULT_HTF_LOOKBACK_DAYS = Number(
  process.env.GET_MARKET_HTF_LOOKBACK_DAYS ?? Math.max(DEFAULT_LOOKBACK_DAYS, 20)
);
const OPEN_INTEREST_PERIOD = "5m";
const OPEN_INTEREST_PAD_MS = 2 * 60 * 60 * 1000; // 2h window for averaging
const FUNDING_PAD_MS = 3 * 24 * 60 * 60 * 1000; // 3d window for funding history
const MINUTE_WARMUP_MS =
  Number(process.env.GET_MARKET_WARMUP_MINUTES ?? 120) * 60 * 1000;
const HTF_WARMUP_PERIODS = Number(process.env.GET_MARKET_WARMUP_HTF ?? 30);

let proxyConfigured = false;
let proxyAgent = null;
let fetchImpl = null;

async function configureProxy() {
  if (proxyConfigured) return;
  const proxyUrl =
    process.env.GET_MARKET_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY;
  if (proxyUrl) {
    try {
      const { ProxyAgent, fetch: undiciFetch } = await import("undici");
      proxyAgent = new ProxyAgent(proxyUrl);
      fetchImpl = undiciFetch;
      logger.info(LOG_MODULE, "Proxy enabled for market import", { proxy: proxyUrl });
    } catch (err) {
      logger.warn(LOG_MODULE, "Proxy setup failed", { error: err?.message });
    }
  }
  if (!fetchImpl) {
    try {
      const { fetch: undiciFetch } = await import("undici");
      fetchImpl = undiciFetch;
    } catch {
      fetchImpl = globalThis.fetch;
    }
  }
  proxyConfigured = true;
}

function alignTo(value, intervalMs) {
  return Math.floor(value / intervalMs) * intervalMs;
}

function parseIsoToMs(iso, fallback) {
  if (!iso) return fallback;
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) ? ts : fallback;
}

function resolveTimeRange(options = {}) {
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const envEnd = parseIsoToMs(process.env.GET_MARKET_END, now);
  const envStart = parseIsoToMs(
    process.env.GET_MARKET_START,
    envEnd - DEFAULT_LOOKBACK_DAYS * dayMs
  );

  const endMs = alignTo(
    options.endMs ?? envEnd ?? now,
    INTERVAL_MS[TIMEFRAME_MIN]
  );
  const lookbackDays = Number(
    options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
  );
  const startMs = alignTo(
    options.startMs ?? envStart ?? endMs - lookbackDays * dayMs,
    INTERVAL_MS[TIMEFRAME_MIN]
  );
  if (startMs >= endMs) {
    throw new Error("startMs must be earlier than endMs for market import.");
  }
  return { startMs, endMs, lookbackDays };
}

async function fetchJSON(url, description, attempt = 1, { useProxy = true } = {}) {
  await configureProxy();
  try {
    const resp = await (fetchImpl ?? fetch)(url, {
      dispatcher: useProxy && proxyAgent ? proxyAgent : undefined,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`${description} failed ${resp.status}: ${text || url}`);
    }
    return resp.json();
  } catch (error) {
    if (useProxy && proxyAgent) {
      // 代理失败时退回直连
      return fetchJSON(url, description, attempt, { useProxy: false });
    }
    if (attempt >= MAX_RETRY) throw error;
    const delay = 500 * attempt;
    logger.warn(LOG_MODULE, `${description} retry ${attempt} in ${delay}ms`, {
      error: error?.message,
    });
    await new Promise((resolve) => setTimeout(resolve, delay));
    return fetchJSON(url, description, attempt + 1);
  }
}

async function fetchBinanceKlines({ symbol, interval, startTime, endTime }) {
  const klines = [];
  let cursor = startTime;
  const intervalMs = INTERVAL_MS[interval];

  while (cursor < endTime) {
    const url = new URL("/fapi/v1/klines", BINANCE_FAPI_BASE);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", MAX_KLINE_LIMIT.toString());
    url.searchParams.set("startTime", cursor);
    url.searchParams.set("endTime", Math.min(endTime, cursor + MAX_KLINE_LIMIT * intervalMs));

    const batch = await fetchJSON(url, `${symbol} ${interval} klines`);
    if (!Array.isArray(batch) || !batch.length) break;

    klines.push(...batch);
    const lastOpen = batch[batch.length - 1][0];
    cursor = lastOpen + intervalMs;

    if (batch.length < MAX_KLINE_LIMIT) break;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  return klines;
}

async function fetchOpenInterestSeries({ symbol, startTime, endTime }) {
  const periodMs = {
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "30m": 30 * 60 * 1000,
    "1h": 60 * 60 * 1000,
  }[OPEN_INTEREST_PERIOD];
  const series = [];
  let from = startTime;
  const safeEnd = Math.min(endTime, Date.now());

  while (from < safeEnd) {
    const url = new URL("/futures/data/openInterestHist", BINANCE_FAPI_BASE);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("period", OPEN_INTEREST_PERIOD);
    url.searchParams.set("limit", "500");
    url.searchParams.set("startTime", from);
    url.searchParams.set("endTime", safeEnd);

    const batch = await fetchJSON(url, `${symbol} openInterestHist`);
    if (!Array.isArray(batch) || !batch.length) break;

    series.push(
      ...batch.map((item) => ({
        ts: Number(item.timestamp),
        value: Number(item.sumOpenInterest ?? item.openInterest ?? item.sumOpenInterestValue),
      }))
    );
    const lastTs = Number(batch[batch.length - 1].timestamp);
    if (!Number.isFinite(lastTs) || lastTs === from) break;
    from = lastTs + periodMs;

    if (batch.length < 500) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return series.sort((a, b) => a.ts - b.ts);
}

async function fetchFundingRateSeries({ symbol, startTime, endTime }) {
  const series = [];
  let from = startTime;
  const safeEnd = Math.min(endTime, Date.now());

  while (from < safeEnd) {
    const url = new URL("/fapi/v1/fundingRate", BINANCE_FAPI_BASE);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("limit", "1000");
    url.searchParams.set("startTime", from);
    url.searchParams.set("endTime", safeEnd);

    const batch = await fetchJSON(url, `${symbol} fundingRate history`);
    if (!Array.isArray(batch) || !batch.length) break;

    series.push(
      ...batch.map((item) => ({
        ts: Number(item.fundingTime),
        value: Number(item.fundingRate),
      }))
    );
    const lastTs = Number(batch[batch.length - 1].fundingTime);
    if (!Number.isFinite(lastTs) || lastTs === from) break;
    from = lastTs + 1;

    if (batch.length < 1000) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return series.sort((a, b) => a.ts - b.ts);
}

function normaliseKlines(raw = []) {
  return raw
    .map((item) => {
      if (!Array.isArray(item) || item.length < 6) return null;
      return {
        ts: Number(item[0]),
        open: Number(item[1]),
        high: Number(item[2]),
        low: Number(item[3]),
        close: Number(item[4]),
        volume: Number(item[5]),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts);
}

function padSeries(length, values) {
  const padding = length - values.length;
  return padding <= 0 ? values : Array(padding).fill(null).concat(values);
}

function enrichCandlesWithMeta(candles, openInterestSeries, fundingSeries, windowSize = 20) {
  if (!candles.length) return candles;

  let oiIndex = 0;
  let fundingIndex = 0;
  let latestOI = null;
  let latestFunding = null;
  const window = [];

  for (const candle of candles) {
    const ts = candle.ts;

    while (oiIndex < openInterestSeries.length && openInterestSeries[oiIndex].ts <= ts) {
      latestOI = openInterestSeries[oiIndex].value;
      oiIndex += 1;
    }

    if (latestOI != null && Number.isFinite(latestOI)) {
      candle.openInterest = latestOI;
      window.push(latestOI);
      if (window.length > windowSize) window.shift();
      const valid = window.filter((v) => v != null && Number.isFinite(v));
      candle.openInterestAvg =
        valid.length > 0 ? valid.reduce((sum, v) => sum + v, 0) / valid.length : null;
    } else {
      candle.openInterest = candle.openInterest ?? null;
      candle.openInterestAvg = candle.openInterestAvg ?? null;
    }

    while (fundingIndex < fundingSeries.length && fundingSeries[fundingIndex].ts <= ts) {
      latestFunding = fundingSeries[fundingIndex].value;
      fundingIndex += 1;
    }
    candle.fundingRate =
      latestFunding != null && !Number.isNaN(latestFunding) ? latestFunding : candle.fundingRate ?? null;
  }

  return candles;
}

function decorateIndicators(interval, candles) {
  if (!candles.length) return [];

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  const ema20 = padSeries(candles.length, EMA.calculate({ period: 20, values: closes }));
  const ema50 = padSeries(candles.length, EMA.calculate({ period: 50, values: closes }));

  const macdRaw = MACD.calculate({
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    values: closes,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  }).map((entry) => entry.MACD);
  const macd = padSeries(candles.length, macdRaw);

  const rsi7 = padSeries(candles.length, RSI.calculate({ period: 7, values: closes }));
  const rsi14 = padSeries(candles.length, RSI.calculate({ period: 14, values: closes }));
  const atr3 = padSeries(candles.length, ATR.calculate({ period: 3, high: highs, low: lows, close: closes }));
  const atr14 = padSeries(candles.length, ATR.calculate({ period: 14, high: highs, low: lows, close: closes }));
  const volumeAvg = padSeries(candles.length, SMA.calculate({ period: 20, values: volumes }));

  return candles.map((candle, index) => ({
    ...candle,
    priceMid: (candle.open + candle.close) / 2,
    ema20: ema20[index],
    ema50: ema50[index],
    macd: macd[index],
    rsi7: rsi7[index],
    rsi14: rsi14[index],
    atr3: atr3[index],
    atr14: atr14[index],
    volumeAvg: volumeAvg[index],
  }));
}

function buildHistoryRow(symbol, timeframe, candle) {
  return {
    symbol: ensureMarketSymbol(symbol),
    timeframe,
    ts: candle.ts,
    price_mid: candle.priceMid,
    ema20: candle.ema20,
    ema50: candle.ema50 ?? null,
    macd: candle.macd,
    rsi_7: candle.rsi7,
    rsi_14: candle.rsi14,
    open_interest: candle.openInterest ?? null,
    open_interest_avg: candle.openInterestAvg ?? null,
    funding_rate: candle.fundingRate ?? null,
    volume: candle.volume,
    volume_avg: candle.volumeAvg,
    atr_3: candle.atr3,
    atr_14: candle.atr14,
    ema20_htf: timeframe === TIMEFRAME_HTF ? candle.ema20 : null,
    ema50_htf: timeframe === TIMEFRAME_HTF ? candle.ema50 : null,
  };
}

function buildLatestRow(symbol, minuteSeries, htfSeries) {
  if (!minuteSeries.length) throw new Error(`Symbol ${symbol} has no minute data.`);

  const latest = minuteSeries[minuteSeries.length - 1];
  const first = minuteSeries[0];
  const htfLatest = htfSeries[htfSeries.length - 1] ?? {};

  const highs = minuteSeries.map((row) => row.high);
  const lows = minuteSeries.map((row) => row.low);

  const highPrice = highs.length ? Math.max(...highs) : latest.close;
  const lowPrice = lows.length ? Math.min(...lows) : latest.close;

  return {
    symbol: ensureMarketSymbol(symbol),
    price: latest.close,
    change_percent: first?.close ? ((latest.close - first.close) / first.close) * 100 : null,
    high_price: highPrice,
    low_price: lowPrice,
    volume: latest.volume,
    volume_avg: latest.volumeAvg,
    ema20: latest.ema20,
    ema50: latest.ema50,
    macd: latest.macd,
    rsi_7: latest.rsi7,
    rsi_14: latest.rsi14,
    open_interest: latest.openInterest ?? null,
    open_interest_avg: latest.openInterestAvg ?? null,
    funding_rate: latest.fundingRate ?? null,
    atr_3: latest.atr3,
    atr_14: latest.atr14,
    ema20_htf: htfLatest.ema20 ?? null,
    ema50_htf: htfLatest.ema50 ?? null,
    macd_htf: htfLatest.macd ?? null,
    rsi_14_htf: htfLatest.rsi14 ?? null,
    last_update_ts: new Date(latest.ts),
    raw_payload: {
      interval: TIMEFRAME_MIN,
      count: minuteSeries.length,
    },
  };
}

async function persistSymbolData({
  symbol,
  minuteCandles,
  higherCandles,
  existingMinuteTs = null,
  existingHtfTs = null,
}) {
  if (!minuteCandles.length) {
    logger.warn(LOG_MODULE, `Skip ${symbol}: no minute candles.`);
    return { symbol, minuteInserted: 0, htfInserted: 0 };
  }

  let minuteInserted = 0;
  for (const candle of minuteCandles) {
    if (existingMinuteTs && candle.ts <= existingMinuteTs) continue;
    await insertMarketPriceSnapshot(buildHistoryRow(symbol, TIMEFRAME_MIN, candle));
    minuteInserted += 1;
  }

  let htfInserted = 0;
  for (const candle of higherCandles) {
    if (existingHtfTs && candle.ts <= existingHtfTs) continue;
    await insertMarketPriceSnapshot(buildHistoryRow(symbol, TIMEFRAME_HTF, candle));
    htfInserted += 1;
  }

  await upsertMarketPrice(buildLatestRow(symbol, minuteCandles, higherCandles));
  return { symbol, minuteInserted, htfInserted };
}

async function syncSymbol({
  symbol,
  startMs,
  endMs,
  htfStartMs,
  existingMinuteTs = null,
  existingHtfTs = null,
}) {
  const htfRangeStart = Math.min(htfStartMs, startMs);
  const oiStart = Math.max(0, htfRangeStart - OPEN_INTEREST_PAD_MS);
  const fundingStart = Math.max(0, htfRangeStart - FUNDING_PAD_MS);

  const [minuteKlines, htfKlines] = await Promise.all([
    fetchBinanceKlines({
      symbol,
      interval: TIMEFRAME_MIN,
      startTime: startMs,
      endTime: endMs,
    }),
    fetchBinanceKlines({
      symbol,
      interval: TIMEFRAME_HTF,
      startTime: htfStartMs,
      endTime: endMs,
    }),
  ]);

  const minuteCandles = decorateIndicators(TIMEFRAME_MIN, normaliseKlines(minuteKlines));
  const higherCandles = decorateIndicators(TIMEFRAME_HTF, normaliseKlines(htfKlines));

  const [openInterestSeries, fundingSeries] = await Promise.all([
    fetchOpenInterestSeries({
      symbol,
      startTime: oiStart,
      endTime: endMs + OPEN_INTEREST_PAD_MS,
    }).catch((error) => {
      logger.warn(LOG_MODULE, `${symbol} open interest history failed`, { error: error?.message });
      return [];
    }),
    fetchFundingRateSeries({
      symbol,
      startTime: fundingStart,
      endTime: endMs + FUNDING_PAD_MS,
    }).catch((error) => {
      logger.warn(LOG_MODULE, `${symbol} funding history failed`, { error: error?.message });
      return [];
    }),
  ]);

  enrichCandlesWithMeta(minuteCandles, openInterestSeries, fundingSeries, 20);
  enrichCandlesWithMeta(higherCandles, openInterestSeries, fundingSeries, 10);

  return persistSymbolData({
    symbol,
    minuteCandles,
    higherCandles,
    existingMinuteTs,
    existingHtfTs,
  });
}

export async function importMarketData(symbols = [], options = {}) {
  const { startMs, endMs, lookbackDays, htfLookbackDays } = options;
  const { startMs: resolvedStart, endMs: resolvedEnd, lookbackDays: resolvedLookback } =
    resolveTimeRange({ startMs, endMs, lookbackDays });

  const dayMs = 24 * 60 * 60 * 1000;
  const htfLookbackResolved = Number(
    htfLookbackDays ?? DEFAULT_HTF_LOOKBACK_DAYS ?? Math.max(resolvedLookback, 20)
  );
  const htfStart = alignTo(
    Math.max(0, resolvedStart - htfLookbackResolved * dayMs),
    INTERVAL_MS[TIMEFRAME_HTF]
  );

  const results = [];
  for (const raw of symbols) {
    const symbol = ensureMarketSymbol(raw);
    try {
      const outcome = await syncSymbol({
        symbol,
        startMs: resolvedStart,
        endMs: resolvedEnd,
        htfStartMs: htfStart,
      });
      results.push({ ...outcome, startMs: resolvedStart, endMs: resolvedEnd });
    } catch (error) {
      logger.warn(LOG_MODULE, "import failed", { symbol, error: error?.message });
      results.push({ symbol, error: error?.message });
    }
  }
  return results;
}

export async function syncLatestMarketData(symbols = [], options = {}) {
  const results = [];
  const dayMs = 24 * 60 * 60 * 1000;
  const endMs = alignTo(options.endMs ?? Date.now(), INTERVAL_MS[TIMEFRAME_MIN]);
  const lookback = Number(options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS);
  const htfLookback = Number(options.htfLookbackDays ?? DEFAULT_HTF_LOOKBACK_DAYS);

  for (const raw of symbols) {
    const symbol = ensureMarketSymbol(raw);
    try {
      const lastMinuteTs = await getLatestMarketHistoryTimestamp(symbol, TIMEFRAME_MIN);
      const lastHtfTs = await getLatestMarketHistoryTimestamp(symbol, TIMEFRAME_HTF);

      const minuteStart = alignTo(
        lastMinuteTs != null
          ? Math.max(0, lastMinuteTs - MINUTE_WARMUP_MS)
          : endMs - lookback * dayMs,
        INTERVAL_MS[TIMEFRAME_MIN]
      );

      const htfStart = alignTo(
        lastHtfTs != null
          ? Math.max(
              0,
              lastHtfTs - HTF_WARMUP_PERIODS * INTERVAL_MS[TIMEFRAME_HTF]
            )
          : endMs - htfLookback * dayMs,
        INTERVAL_MS[TIMEFRAME_HTF]
      );

      const outcome = await syncSymbol({
        symbol,
        startMs: minuteStart,
        endMs,
        htfStartMs: htfStart,
        existingMinuteTs: lastMinuteTs,
        existingHtfTs: lastHtfTs,
      });
      results.push({ ...outcome, endMs });
    } catch (error) {
      logger.warn(LOG_MODULE, "sync failed", { symbol, error: error?.message });
      results.push({ symbol, error: error?.message });
    }
  }

  return results;
}
