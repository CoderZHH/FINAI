/* eslint-disable no-console */

/**
 * Binance 行情入库脚本
 *
 * 1. 调用 Binance 永续合约 (USDT-M) REST API 获取 1m 与 4h K 线
 * 2. 计算 EMA / MACD / RSI / ATR / 成交量均值等指标
 * 3. 写入 Postgres：
 *      - market_price_history：时间序列
 *      - market_prices：最新快照（含 HTF 指标）
 * 4. 同步补充 Funding / Open Interest（使用 premiumIndex / openInterest 接口）
 * 5. 控制台打印提示词所需字段，便于核对
 *
 * 运行方式：
 *   HYPERLIQUID_PROXY=http://127.0.0.1:7890 \
 *   HYPERLIQUID_START=2024-10-01T00:00:00Z \
 *   HYPERLIQUID_END=2024-11-06T10:16:00Z \
 *   node --env-file=.env.local scripts/seed-hyperliquid.js
 *
 * ⚠️ 依赖：technicalindicators、undici（若需要代理），已在 package.json 中声明
 */

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { performance } = require("node:perf_hooks");
const { EMA, MACD, RSI, ATR, SMA } = require("technicalindicators");

let ProxyAgent = null;
let setGlobalDispatcher = null;
try {
  ({ ProxyAgent, setGlobalDispatcher } = require("undici"));
} catch (error) {
  ProxyAgent = null;
  setGlobalDispatcher = null;
  if (process.env.HYPERLIQUID_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
    console.error("[binance-seed] 检测到代理配置，但未安装 'undici'。请先执行 `npm install undici`。");
    throw error;
  }
}

/** ============================ 基础配置 ============================ */
const RAW_BINANCE_BASE = process.env.BINANCE_BASE_URL ?? "https://fapi.binance.com";
const FUTURES_BASE =
  RAW_BINANCE_BASE.includes("fapi") || RAW_BINANCE_BASE.includes("testnet")
    ? RAW_BINANCE_BASE
    : "https://fapi.binance.com";

const DEFAULT_SYMBOLS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"];
const SYMBOLS = (process.env.HYPERLIQUID_SYMBOLS || DEFAULT_SYMBOLS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Binance 请求使用的真实交易对映射（USDT 永续合约）
const BINANCE_SYMBOL_MAP = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  XRP: "XRPUSDT",
  DOGE: "DOGEUSDT",
  BNB: "BNBUSDT",
};

const TIMEFRAME_MIN = "1m";
const TIMEFRAME_HTF = "4h";
const INTERVAL_MS = {
  [TIMEFRAME_MIN]: 60 * 1000,
  [TIMEFRAME_HTF]: 4 * 60 * 60 * 1000,
};

// 1m 默认抓取最近 3 天，可通过 HYPERLIQUID_LOOKBACK_DAYS 覆盖
const LOOKBACK_DAYS = Number(process.env.HYPERLIQUID_LOOKBACK_DAYS ?? 3);
// 4h 需更多历史以计算 EMA50 / MACD，默认至少 10 天，可通过 HYPERLIQUID_HTF_LOOKBACK_DAYS 改写
const HTF_LOOKBACK_DAYS = Number(
  process.env.HYPERLIQUID_HTF_LOOKBACK_DAYS ?? Math.max(LOOKBACK_DAYS, 20)
);
const START_ISO = process.env.HYPERLIQUID_START ?? null;
const END_ISO = process.env.HYPERLIQUID_END ?? null;
const MAX_RETRY = Number(process.env.HYPERLIQUID_RETRY ?? 3);
const MAX_KLINE_LIMIT = 1500; // Binance API 单次 klines 最大返回数
const OPEN_INTEREST_PERIOD = "5m"; // openInterestHist 最小周期

const proxyUrl =
  process.env.HYPERLIQUID_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  "http://127.0.0.1:7890";

if (ProxyAgent && setGlobalDispatcher) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`[binance-seed] 使用代理 ${proxyUrl}`);
}

/** ============================ 公共工具 ============================ */
const toMs = (iso) => new Date(iso).getTime();

const alignTo = (value, intervalMs) => Math.floor(value / intervalMs) * intervalMs;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function resolveTimeRange() {
  const rawEnd = END_ISO ? toMs(END_ISO) : Date.now();
  if (!Number.isFinite(rawEnd)) throw new Error(`非法的结束时间：${END_ISO}`);

  let rawStart = START_ISO ? toMs(START_ISO) : rawEnd - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(rawStart)) throw new Error(`非法的开始时间：${START_ISO}`);
  if (rawStart >= rawEnd) throw new Error("开始时间必须早于结束时间。");

  return {
    startMs: alignTo(rawStart, INTERVAL_MS[TIMEFRAME_MIN]),
    endMs: alignTo(rawEnd, INTERVAL_MS[TIMEFRAME_MIN]),
  };
}

async function importModule(relativePath) {
  const modulePath = path.join(__dirname, relativePath);
  return import(pathToFileURL(modulePath).href);
}

async function bootstrap() {
  const [{ getPool }, { insertMarketPriceSnapshot, upsertMarketPrice }] = await Promise.all([
    importModule("../lib/db.js"),
    importModule("../lib/dataRepository.js"),
  ]);

  return {
    pool: await getPool(),
    insertMarketPriceSnapshot,
    upsertMarketPrice,
  };
}

/** ============================ Binance 请求封装 ============================ */
async function fetchJSON(url, description, attempt = 1) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${description} failed ${response.status}: ${text}`);
    }
    return response.json();
  } catch (error) {
    if (attempt >= MAX_RETRY) throw error;
    const delay = 500 * attempt;
    console.warn(`[binance-seed] ${description} 第 ${attempt} 次失败 (${error.message})，将在 ${delay}ms 后重试...`);
    await sleep(delay);
    return fetchJSON(url, description, attempt + 1);
  }
}

async function fetchBinanceKlines({ symbol, interval, startTime, endTime }) {
  const klines = [];
  let from = startTime;

  while (from < endTime) {
    const url = new URL("/fapi/v1/klines", FUTURES_BASE);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", MAX_KLINE_LIMIT);
    url.searchParams.set("startTime", from);
    url.searchParams.set("endTime", Math.min(endTime, from + MAX_KLINE_LIMIT * INTERVAL_MS[interval]));

    const batch = await fetchJSON(url, `klines ${symbol} ${interval}`);
    if (!Array.isArray(batch) || batch.length === 0) break;

    klines.push(...batch);
    const lastOpenTime = batch[batch.length - 1][0];
    from = lastOpenTime + INTERVAL_MS[interval];

    if (batch.length < MAX_KLINE_LIMIT) break;
    await sleep(150); // 简单限流
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
    const url = new URL("/futures/data/openInterestHist", FUTURES_BASE);
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
    await sleep(200);
  }

  return series.sort((a, b) => a.ts - b.ts);
}

async function fetchFundingRateSeries({ symbol, startTime, endTime }) {
  const series = [];
  let from = startTime;
  const safeEnd = Math.min(endTime, Date.now());

  while (from < safeEnd) {
    const url = new URL("/fapi/v1/fundingRate", FUTURES_BASE);
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
    await sleep(200);
  }

  return series.sort((a, b) => a.ts - b.ts);
}

/** ============================ 数据预处理 & 指标 ============================ */
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

/** ============================ 数据入库结构 ============================ */
function buildHistoryRow(symbol, timeframe, candle) {
  return {
    symbol,
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
  if (!minuteSeries.length) throw new Error(`Symbol ${symbol} 没有分钟级数据。`);

  const latest = minuteSeries[minuteSeries.length - 1];
  const first = minuteSeries[0];
  const htfLatest = htfSeries[htfSeries.length - 1] ?? {};

  const highPrice = Math.max(...minuteSeries.map((row) => row.high));
  const lowPrice = Math.min(...minuteSeries.map((row) => row.low));

  return {
    symbol,
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
    last_update_ts: latest.ts,
    raw_payload: {
      interval: TIMEFRAME_MIN,
      count: minuteSeries.length,
      fundingRateSource: latest.fundingRate != null ? "history" : "none",
      openInterestSource: latest.openInterest != null ? "history" : "none",
    },
  };
}

async function persistSymbolData({
  symbol,
  minuteCandles,
  higherCandles,
  insertMarketPriceSnapshot,
  upsertMarketPrice,
}) {
  if (!minuteCandles.length) {
    console.warn(`[binance-seed] 跳过 ${symbol}：未获取到分钟数据。`);
    return;
  }

  for (const candle of minuteCandles) {
    await insertMarketPriceSnapshot(buildHistoryRow(symbol, TIMEFRAME_MIN, candle));
  }
  for (const candle of higherCandles) {
    await insertMarketPriceSnapshot(buildHistoryRow(symbol, TIMEFRAME_HTF, candle));
  }

  await upsertMarketPrice(buildLatestRow(symbol, minuteCandles, higherCandles));
}

/** ============================ 主流程：单币种处理 ============================ */
async function handleSymbol({
  promptSymbol,
  binanceSymbol,
  startMs,
  endMs,
  insertMarketPriceSnapshot,
  upsertMarketPrice,
}) {
  console.log(`Fetching ${promptSymbol} (${binanceSymbol}) data...`);
  const t0 = performance.now();

  const htfStart = Math.max(0, startMs - HTF_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [minuteKlines, htfKlines] = await Promise.all([
    fetchBinanceKlines({ symbol: binanceSymbol, interval: TIMEFRAME_MIN, startTime: startMs, endTime: endMs }),
    fetchBinanceKlines({ symbol: binanceSymbol, interval: TIMEFRAME_HTF, startTime: htfStart, endTime: endMs }),
  ]);

  const minuteCandles = decorateIndicators(TIMEFRAME_MIN, normaliseKlines(minuteKlines));
  const higherCandles = decorateIndicators(TIMEFRAME_HTF, normaliseKlines(htfKlines));

  const oiStart = Math.max(0, Math.min(htfStart, startMs) - 2 * 60 * 60 * 1000);
  const fundingStart = Math.max(0, Math.min(htfStart, startMs) - 3 * 24 * 60 * 60 * 1000);

  const [openInterestSeries, fundingSeries] = await Promise.all([
    fetchOpenInterestSeries({
      symbol: binanceSymbol,
      startTime: oiStart,
      endTime: endMs + 2 * 60 * 60 * 1000,
    }).catch((error) => {
      console.warn(`[binance-seed] ${binanceSymbol} open interest history 获取失败：${error.message}`);
      return [];
    }),
    fetchFundingRateSeries({
      symbol: binanceSymbol,
      startTime: fundingStart,
      endTime: endMs + 8 * 60 * 60 * 1000,
    }).catch((error) => {
      console.warn(`[binance-seed] ${binanceSymbol} funding history 获取失败：${error.message}`);
      return [];
    }),
  ]);

  enrichCandlesWithMeta(minuteCandles, openInterestSeries, fundingSeries, 20);
  enrichCandlesWithMeta(higherCandles, openInterestSeries, fundingSeries, 10);

  await persistSymbolData({
    symbol: promptSymbol,
    minuteCandles,
    higherCandles,
    insertMarketPriceSnapshot,
    upsertMarketPrice,
  });

  const t1 = performance.now();
  console.log(
    `Stored ${promptSymbol}: ${minuteCandles.length} minute candles, ${higherCandles.length} HTF candles (took ${(
      (t1 - t0) /
      1000
    ).toFixed(2)}s)`
  );
}

/** ============================ 提示词输出 ============================ */
async function loadPromptData(pool, symbol) {
  const latest = await pool.query(`SELECT * FROM market_prices WHERE symbol = $1`, [symbol]);
  const minuteRows = await pool.query(
    `
      SELECT ts, price_mid, ema20, macd, rsi_7, rsi_14, open_interest, open_interest_avg, funding_rate, volume, volume_avg
      FROM market_price_history
      WHERE symbol = $1 AND timeframe = $2
      ORDER BY ts ASC
    `,
    [symbol, TIMEFRAME_MIN]
  );
  const htfRows = await pool.query(
    `
      SELECT ts, ema20, ema50, macd, rsi_14, atr_3, atr_14, volume
      FROM market_price_history
      WHERE symbol = $1 AND timeframe = $2
      ORDER BY ts ASC
    `,
    [symbol, TIMEFRAME_HTF]
  );

  return {
    snapshot: latest.rows[0] ?? null,
    minuteSeries: minuteRows.rows,
    htfSeries: htfRows.rows,
  };
}

const formatTail = (values, precision = 3) => {
  const tail = values.slice(-10);
  return `[${tail.map((v) => (v == null ? "null" : Number(v).toFixed(precision))).join(", ")}]`;
};

function printPrompt(symbol, snapshot, minuteSeries, htfSeries) {
  if (!snapshot) {
    console.log(`\n=== ${symbol} ===\n暂无数据。`);
    return;
  }

  const lastMinute = minuteSeries[minuteSeries.length - 1] ?? {};
  const lastHTF = htfSeries[htfSeries.length - 1] ?? {};

  console.log(`\n=== ${symbol} PROMPT SNAPSHOT ===`);
  console.log(
    `current_price = ${snapshot.price}, current_ema20 = ${snapshot.ema20}, current_macd = ${snapshot.macd}, current_rsi (7 period) = ${snapshot.rsi_7}`
  );
  console.log(
    `Open Interest: Latest: ${snapshot.open_interest} Average: ${snapshot.open_interest_avg}`
  );
  console.log(`Funding Rate: ${snapshot.funding_rate}`);
  console.log(`Mid prices: ${formatTail(minuteSeries.map((row) => row.price_mid))}`);
  console.log(`EMA indicators (20-period): ${formatTail(minuteSeries.map((row) => row.ema20))}`);
  console.log(`MACD indicators: ${formatTail(minuteSeries.map((row) => row.macd))}`);
  console.log(`RSI indicators (7-Period): ${formatTail(minuteSeries.map((row) => row.rsi_7))}`);
  console.log(`RSI indicators (14-Period): ${formatTail(minuteSeries.map((row) => row.rsi_14))}`);

  console.log("\n-- 4h Context --");
  console.log(`20-Period EMA: ${lastHTF.ema20} vs. 50-Period EMA: ${lastHTF.ema50}`);
  console.log(`3-Period ATR: ${lastHTF.atr_3} vs. 14-Period ATR: ${lastHTF.atr_14}`);
  console.log(
    `Current Volume: ${lastMinute.volume} vs. Average Volume: ${lastMinute.volume_avg}`
  );
  console.log(`MACD indicators: ${formatTail(htfSeries.map((row) => row.macd))}`);
  console.log(`RSI indicators (14-Period): ${formatTail(htfSeries.map((row) => row.rsi_14))}`);
}

/** ============================ 主入口 ============================ */
async function main() {
  const { pool, insertMarketPriceSnapshot, upsertMarketPrice } = await bootstrap();
  const { startMs, endMs } = resolveTimeRange();

  try {
    for (const symbol of SYMBOLS) {
      const binanceSymbol = BINANCE_SYMBOL_MAP[symbol];
      if (!binanceSymbol) {
        console.warn(`[binance-seed] 未配置 ${symbol} 对应的 Binance 交易对，跳过。`);
        continue;
      }

      await handleSymbol({
        promptSymbol: symbol,
        binanceSymbol,
        startMs,
        endMs,
        insertMarketPriceSnapshot,
        upsertMarketPrice,
      });
    }

    for (const symbol of SYMBOLS) {
      const { snapshot, minuteSeries, htfSeries } = await loadPromptData(pool, symbol);
      printPrompt(symbol, snapshot, minuteSeries, htfSeries);
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Binance seed script failed:", error);
    process.exitCode = 1;
  });
}
