/* eslint-disable no-console */
const { Pool } = require("pg");
const Redis = require("ioredis");

if (!process.env.POSTGRES_URL) {
  console.error("POSTGRES_URL is not configured. Unable to write to database.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false })
  : null;

const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "DOGEUSDT", "XRPUSDT"];

function resolveSymbols() {
  try {
    return JSON.parse(process.env.BINANCE_SYMBOLS || JSON.stringify(DEFAULT_SYMBOLS));
  } catch (err) {
    console.warn("BINANCE_SYMBOLS parse failed, fallback to defaults.", err);
    return DEFAULT_SYMBOLS;
  }
}

const symbols = resolveSymbols();

function normalizeSymbol(symbol) {
  return symbol.replace(/USDT$/i, "");
}

async function fetchTickers() {
  const baseUrl = process.env.BINANCE_BASE_URL || "https://api.binance.com";
  const url = `${baseUrl}/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
  const controller = new AbortController();
  const timeoutMs = Number(process.env.BINANCE_TIMEOUT_MS || 20000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch Binance tickers: ${response.status} ${response.statusText}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function upsertTickers(tickers) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const ticker of tickers) {
      const payload = {
        symbol: ticker.symbol,
        price: Number(ticker.lastPrice),
        changePercent: Number(ticker.priceChangePercent),
        highPrice: Number(ticker.highPrice),
        lowPrice: Number(ticker.lowPrice),
        volume: Number(ticker.volume),
        lastUpdateTs: new Date(),
      };

      await client.query(
        `
        INSERT INTO market_prices(symbol, price, change_percent, high_price, low_price, volume, last_update_ts, raw_payload)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (symbol) DO UPDATE SET
          price = EXCLUDED.price,
          change_percent = EXCLUDED.change_percent,
          high_price = EXCLUDED.high_price,
          low_price = EXCLUDED.low_price,
          volume = EXCLUDED.volume,
          last_update_ts = EXCLUDED.last_update_ts,
          raw_payload = EXCLUDED.raw_payload,
          updated_at = now();
      `,
        [
          payload.symbol,
          payload.price,
          payload.changePercent,
          payload.highPrice,
          payload.lowPrice,
          payload.volume,
          payload.lastUpdateTs,
          ticker,
        ]
      );

      if (redis) {
        await redis.set(
          `prices:${payload.symbol}`,
          JSON.stringify({
            symbol: payload.symbol,
            price: payload.price,
            changePercent: payload.changePercent,
            highPrice: payload.highPrice,
            lowPrice: payload.lowPrice,
            volume: payload.volume,
            lastUpdateTs: payload.lastUpdateTs.getTime(),
          }),
          "EX",
          Number(process.env.REDIS_PRICE_TTL || 120)
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  console.log(`[fetch-prices] fetching ${symbols.length} trading pairs...`);
  const tickers = await fetchTickers();
  await upsertTickers(tickers);
  console.log(
    `[fetch-prices] updated ${tickers.length} tickers. Sample:`,
    tickers
      .slice(0, 3)
      .map((t) => `${normalizeSymbol(t.symbol)}=${t.lastPrice}`)
      .join(", ")
  );
}

main()
  .catch((err) => {
    console.error("[fetch-prices] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
    if (redis) {
      await redis.quit();
    }
  });
