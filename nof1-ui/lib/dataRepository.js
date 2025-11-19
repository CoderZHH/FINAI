import { getPool } from "./db.js";
import { getRedis } from "./redis.js";
import { getFeeRate, getFundingConfig } from "./simConfig.js";
import { runLiquidationCheckForAccount } from "./liquidationEngine.js";
import { distributeAdlLoss } from "./adlEngine.js";
import { logger } from "./logManager.js";

/**
 * Trading pairs tracked by the system. BINANCE_SYMBOLS env var can override the list.
 */
const DEFAULT_SYMBOLS = (() => {
  try {
    return JSON.parse(
      process.env.BINANCE_SYMBOLS ||
        '["BTC","ETH","SOL","BNB","DOGE","XRP"]'
    );
  } catch (err) {
    console.warn("BINANCE_SYMBOLS parse failed, using default symbols.", err);
    return ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"];
  }
})();

const NORMALIZED_SYMBOLS = DEFAULT_SYMBOLS.map(normalizeSymbol);
const BASELINE_MODEL_ID = "btc_benchmark";
const DEFAULT_MODEL_ICON = "icon:gpt";
const FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;
let promptTemplateSchemaEnsured = false;

const PLACEHOLDER_REGEX = /\{([a-zA-Z0-9_]+)\}/g;

function normalizeSymbol(symbol) {
  if (!symbol) return symbol;
  return String(symbol).toUpperCase().replace(/USDT$/, "");
}

function ensureMarketSymbol(symbol) {
  if (!symbol) return symbol;
  const upper = String(symbol).toUpperCase();
  return upper.endsWith("USDT") ? upper : `${upper}USDT`;
}

async function ensurePromptTemplateSchema() {
  if (promptTemplateSchemaEnsured) return;
  const pool = getPool();
  try {
    await pool.query(`
      ALTER TABLE IF EXISTS prompt_templates
        ADD COLUMN IF NOT EXISTS sample_market_state_text TEXT,
        ADD COLUMN IF NOT EXISTS sample_position_state_text TEXT
    `);
    promptTemplateSchemaEnsured = true;
  } catch (error) {
    console.error("[dataRepository] ensurePromptTemplateSchema failed", error);
    throw error;
  }
}

export function getTrackedSymbols() {
  return [...NORMALIZED_SYMBOLS];
}

export async function getMarkPrice(symbol) {
  const pool = await getPool();
  const normalized = normalizeSymbol(symbol);
  const { rows } = await pool.query(
    `
    SELECT mark_price, price
    FROM market_prices
    WHERE symbol = $1
    `,
    [normalized]
  );

  if (!rows.length) return null;
  const row = rows[0];
  const mark = row.mark_price != null ? Number(row.mark_price) : null;
  if (mark != null && Number.isFinite(mark)) {
    return mark;
  }
  const fallback = row.price != null ? Number(row.price) : null;
  return Number.isFinite(fallback) ? fallback : null;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeTimestamp(dateLike) {
  if (!dateLike) return Date.now();
  const ts = dateLike instanceof Date ? dateLike : new Date(dateLike);
  return Number.isNaN(ts.getTime()) ? Date.now() : ts.getTime();
}

function sanitizeJsonValue(value, { depth = 0, maxDepth = 20 } = {}) {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (depth > maxDepth) return undefined;

  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") {
    return Number.isNaN(value) ? undefined : value;
  }
  if (type === "bigint") {
    const asNumber = Number(value);
    return Number.isFinite(asNumber) ? asNumber : value.toString();
  }
  if (Array.isArray(value)) {
    const items = value
      .map((entry) => sanitizeJsonValue(entry, { depth: depth + 1, maxDepth }))
      .filter((entry) => entry !== undefined);
    return items;
  }
  if (type === "object") {
    const result = {};
    Object.entries(value).forEach(([key, entry]) => {
      const sanitized = sanitizeJsonValue(entry, { depth: depth + 1, maxDepth });
      if (sanitized !== undefined) {
        result[key] = sanitized;
      }
    });
    return result;
  }
  return undefined;
}

export function summarizeMarginAccount(walletBalanceInput, positions = []) {
  const walletBalance = toNumber(walletBalanceInput ?? 0);
  const totals = positions.reduce(
    (acc, pos) => {
      const entryPrice = toNumber(pos.entry_price ?? 0);
      const quantity = Math.abs(toNumber(pos.quantity ?? 0));
      const leverageRaw = Number(pos.leverage ?? 1);
      const leverage = Number.isFinite(leverageRaw) && leverageRaw > 0 ? leverageRaw : 1;
      const rawNotional =
        pos.notional_usd != null ? Math.abs(toNumber(pos.notional_usd)) : Math.abs(entryPrice * quantity);
      const margin = leverage > 0 ? rawNotional / leverage : rawNotional;
      const unrealized = toNumber(pos.unrealized_pnl ?? 0);
      const symbolKey = String(pos.symbol ?? "").toUpperCase();
      acc.totalUnrealized += unrealized;
      acc.totalInitialMargin += margin;
      acc.marginBySymbol[symbolKey] =
        (acc.marginBySymbol[symbolKey] ?? 0) + margin;
      return acc;
    },
    { totalUnrealized: 0, totalInitialMargin: 0, marginBySymbol: {} }
  );

  const equity = walletBalance + totals.totalUnrealized;
  const availableBalance = walletBalance - totals.totalInitialMargin;

  const result = {
    walletBalance,
    totalUnrealized: totals.totalUnrealized,
    totalInitialMargin: totals.totalInitialMargin,
    marginBySymbol: totals.marginBySymbol,
    equity,
    availableBalance,
  };
  logger.info("risk.summarizeMarginAccount", {
    wallet_balance_input: walletBalance,
    total_unrealized: totals.totalUnrealized,
    total_initial_margin: totals.totalInitialMargin,
    equity,
    available_balance: availableBalance,
    margin_by_symbol: totals.marginBySymbol,
  });
  return result;
}

export async function hasOpenPositionsForSymbol(symbol) {
  if (!symbol) return false;
  const pool = getPool();
  const target = ensureMarketSymbol(symbol);
  const normalized = target ? target.toUpperCase() : symbol.toUpperCase();
  const bare = normalized.replace(/USDT$/, "");
  const { rows } = await pool.query(
    `
    SELECT COUNT(*)::int AS total
    FROM trades
    WHERE exit_time IS NULL
      AND (symbol = $1 OR symbol = $2)
    `,
    [normalized, bare]
  );
  return Number(rows?.[0]?.total ?? 0) > 0;
}

function buildFundingRateMap(snapshot) {
  const rates = {};
  if (!snapshot?.prices) return rates;
  Object.entries(snapshot.prices).forEach(([symbol, ticker]) => {
    rates[symbol] = toNumber(ticker?.funding_rate ?? 0);
  });
  return rates;
}

function applyFundingSettlements(account, positions, fundingRates, fundingCfg, nowTs) {
  const metadata = { ...(account.metadata ?? {}) };
  const fundingMeta = { ...(metadata.funding ?? {}) };
  if (!fundingCfg.enabled || !positions.length) {
    return { walletDelta: 0, metadata };
  }
  const intervalMs = fundingCfg.interval_ms ?? FUNDING_INTERVAL_MS;
  const lastTs = Number(fundingMeta.last_settlement_ts ?? 0);
  if (
    !Number.isFinite(lastTs) ||
    lastTs <= 0 ||
    nowTs - lastTs < intervalMs
  ) {
    if (!Number.isFinite(lastTs) || lastTs <= 0) {
      fundingMeta.last_settlement_ts = nowTs;
      metadata.funding = fundingMeta;
    }
    if (nowTs - (lastTs || 0) < intervalMs) {
      return { walletDelta: 0, metadata };
    }
  }

  let walletDelta = 0;
  positions.forEach((position) => {
    const symbolKey = normalizeSymbol(position.symbol);
    const baseNotional =
      position.notional_usd != null
        ? Math.abs(Number(position.notional_usd))
        : Math.abs(
            Number(position.entry_price ?? 0) * Number(position.quantity ?? 0)
          );
    if (!baseNotional) return;
    const rawRate =
      fundingCfg.mode === "real"
        ? toNumber(fundingRates[symbolKey] ?? 0)
        : fundingCfg.fixed_rate;
    if (!rawRate) return;
    const sideSign =
      String(position.side ?? "LONG").toUpperCase() === "LONG" ? 1 : -1;
    const cashflow = -sideSign * baseNotional * rawRate;
    if (!Number.isFinite(cashflow) || cashflow === 0) return;
    walletDelta += cashflow;
  });

  fundingMeta.last_settlement_ts = nowTs;
  metadata.funding = fundingMeta;
  return { walletDelta, metadata };
}

async function fetchRedisTickers(symbols) {
  const redis = getRedis();
  if (!redis) {
    return new Array(symbols.length).fill(null);
  }

  const redisKeys = symbols.map((symbol) => `prices:${symbol}`);
  try {
    return await redis.mget(redisKeys);
  } catch (error) {
    console.warn("[market] Redis ticker fetch failed, falling back to DB prices.", error);
    return new Array(symbols.length).fill(null);
  }
}

async function fetchDbTickers(pool, symbols) {
  if (!symbols.length) return [];
  const { rows } = await pool.query(
    `
    SELECT
      symbol,
      price,
      change_percent,
      volume,
      volume_avg,
      ema20,
      macd,
      rsi_7,
      rsi_14,
      open_interest,
      open_interest_avg,
      funding_rate,
      atr_3,
      atr_14,
      ema20_htf,
      ema50_htf,
      macd_htf,
      rsi_14_htf,
      last_update_ts
    FROM market_prices
    WHERE symbol = ANY($1)
    `,
    [symbols]
  );
  return rows;
}

function hydrateTickerFromRedis(redisPayload, symbol) {
  if (!redisPayload) return null;
  try {
    const parsed = JSON.parse(redisPayload);
    return {
      symbol,
      price: toNumber(parsed.price),
      change: parsed.changePercent != null ? toNumber(parsed.changePercent) : null,
      timestamp: parsed.lastUpdateTs ?? Date.now(),
    };
  } catch (err) {
    console.warn("Failed to parse redis ticker payload", err);
    return null;
  }
}

function hydrateTickerFromDb(row) {
  return {
    symbol: row.symbol,
    price: toNumber(row.price),
    change: row.change_percent != null ? toNumber(row.change_percent) : null,
    volume: row.volume != null ? toNumber(row.volume) : null,
    volume_avg: row.volume_avg != null ? toNumber(row.volume_avg) : null,
    ema20: row.ema20 != null ? toNumber(row.ema20) : null,
    macd: row.macd != null ? toNumber(row.macd) : null,
    rsi_7: row.rsi_7 != null ? toNumber(row.rsi_7) : null,
    rsi_14: row.rsi_14 != null ? toNumber(row.rsi_14) : null,
    open_interest: row.open_interest != null ? toNumber(row.open_interest) : null,
    open_interest_avg:
      row.open_interest_avg != null ? toNumber(row.open_interest_avg) : null,
    funding_rate:
      row.funding_rate != null ? toNumber(row.funding_rate) : null,
    atr_3: row.atr_3 != null ? toNumber(row.atr_3) : null,
    atr_14: row.atr_14 != null ? toNumber(row.atr_14) : null,
    ema20_htf: row.ema20_htf != null ? toNumber(row.ema20_htf) : null,
    ema50_htf: row.ema50_htf != null ? toNumber(row.ema50_htf) : null,
    macd_htf: row.macd_htf != null ? toNumber(row.macd_htf) : null,
    rsi_14_htf: row.rsi_14_htf != null ? toNumber(row.rsi_14_htf) : null,
    timestamp: row.last_update_ts ? row.last_update_ts.getTime() : Date.now(),
  };
}

function mapModelRow(row, { includeSecrets = true } = {}) {
  const apiKey = row.api_key ?? "";
  const startingEquity =
    row.account_starting_equity != null ? toNumber(row.account_starting_equity) : null;
  const latestEquity =
    row.account_latest_equity != null ? toNumber(row.account_latest_equity) : null;
  const availableCash =
    row.account_available_cash != null ? toNumber(row.account_available_cash) : null;
  const totalUnrealized =
    row.account_total_unrealized_pnl != null ? toNumber(row.account_total_unrealized_pnl) : null;
  const template =
    row.prompt_template_id != null
      ? {
          id: row.prompt_template_id,
          name: row.prompt_template_name ?? null,
          placeholder_tokens: row.prompt_template_tokens ?? [],
          is_default: Boolean(row.prompt_template_is_default),
          sample_market_state_text: row.prompt_template_sample_market_state ?? null,
          sample_position_state_text: row.prompt_template_sample_position ?? null,
          system_prompt: row.prompt_template_system_prompt ?? "",
          user_prompt: row.prompt_template_user_prompt ?? "",
        }
      : null;
  return {
    model_id: row.model_id,
    display_name: row.display_name ?? row.model_id,
    api_base_url: row.api_base_url ?? "",
    api_key: includeSecrets ? apiKey : "",
    display_icon: row.display_icon ?? DEFAULT_MODEL_ICON,
    margin_config: row.margin_config ?? {},
    has_api_key: Boolean(apiKey),
    system_prompt: template?.system_prompt ?? "",
    user_prompt: template?.user_prompt ?? "",
    human_review_required: Boolean(row.human_review_required ?? false),
    prompt_template_id: row.prompt_template_id ?? null,
    prompt_template: template,
    auto_run_enabled: Boolean(row.auto_run_enabled ?? false),
    auto_run_interval_minutes: row.auto_run_interval_minutes
      ? Number(row.auto_run_interval_minutes)
      : 5,
    last_auto_run_at: row.last_auto_run_at ? safeTimestamp(row.last_auto_run_at) : null,
    next_auto_run_at: row.next_auto_run_at ? safeTimestamp(row.next_auto_run_at) : null,
    created_at: row.created_at ? safeTimestamp(row.created_at) : null,
    updated_at: row.updated_at ? safeTimestamp(row.updated_at) : null,
    starting_equity: startingEquity,
    latest_equity: latestEquity,
    available_cash: availableCash,
    total_unrealized_pnl: totalUnrealized,
  };
}

function mapPromptTemplateRow(row, options = {}) {
  const includeContent = options.includeContent !== false;
  const base = {
    id: row.id,
    template_name: row.template_name,
    description: row.description ?? "",
    placeholder_tokens: row.placeholder_tokens ?? [],
    sample_market_state_text: row.sample_market_state_text ?? "",
    sample_position_state_text: row.sample_position_state_text ?? "",
    is_default: Boolean(row.is_default),
    created_at: row.created_at ? safeTimestamp(row.created_at) : null,
    updated_at: row.updated_at ? safeTimestamp(row.updated_at) : null,
  };
  if (includeContent) {
    base.system_prompt = row.system_prompt ?? "";
    base.user_prompt = row.user_prompt ?? "";
  }
  return base;
}

function extractPlaceholderTokensFromText(...payloads) {
  const tokens = new Set();
  payloads
    .filter((text) => typeof text === "string" && text.length)
    .forEach((text) => {
      PLACEHOLDER_REGEX.lastIndex = 0;
      let match = PLACEHOLDER_REGEX.exec(text);
      while (match) {
        tokens.add(match[1]);
        match = PLACEHOLDER_REGEX.exec(text);
      }
    });
  PLACEHOLDER_REGEX.lastIndex = 0;
  return Array.from(tokens);
}

function mapAccountRow(row) {
  const startingEquity = toNumber(row.starting_equity ?? 10000);
  const latestEquity = toNumber(row.latest_equity ?? startingEquity);
  const pnlPct = startingEquity
    ? Number(((latestEquity / startingEquity) - 1).toFixed(4))
    : 0;

  return {
    model_id: row.model_id,
    name: row.display_name ?? row.model_id,
    display_name: row.display_name ?? row.model_id,
    system_prompt: row.template_system_prompt ?? "",
    user_prompt: row.template_user_prompt ?? "",
    latest_equity: latestEquity,
    pnl_pct: pnlPct,
    sharpe_ratio: toNumber(row.sharpe_ratio ?? 0),
    win_rate: toNumber(row.win_rate ?? 0),
    total_trades: Number(row.trade_count ?? 0),
    baseline: Boolean(row.is_baseline ?? false),
    available_cash: toNumber(row.available_cash ?? latestEquity),
    starting_equity: startingEquity,
    total_unrealized_pnl: toNumber(row.total_unrealized_pnl ?? 0),
    human_review_required: Boolean(row.human_review_required ?? false),
    metadata: row.runtime_metadata ?? {},
  };
}

export async function getMarketSnapshot() {
  const pool = getPool();

  const redisRows = await fetchRedisTickers(DEFAULT_SYMBOLS);
  const prices = {};
  const missingSymbols = [];

  redisRows.forEach((payload, idx) => {
    const symbol = DEFAULT_SYMBOLS[idx];
    const ticker = hydrateTickerFromRedis(payload, symbol);
    if (ticker) {
      prices[normalizeSymbol(symbol)] = ticker;
    } else {
      missingSymbols.push(symbol);
    }
  });

  if (missingSymbols.length) {
    const dbRows = await fetchDbTickers(pool, missingSymbols);
    dbRows.forEach((row) => {
      const normalized = normalizeSymbol(row.symbol);
      prices[normalized] = hydrateTickerFromDb(row);
    });
  }

  return {
    order: NORMALIZED_SYMBOLS,
    prices,
    serverTime: Date.now(),
    mode: "live",
    replayTimestamp: null,
  };
}

export async function getTickerRows() {
  const snapshot = await getMarketSnapshot();
  return snapshot.order.map((symbol) => {
    const ticker = snapshot.prices[symbol];
    return {
      symbol,
      price: ticker ? toNumber(ticker.price) : 0,
      change: ticker?.change ?? null,
    };
  });
}

export async function updateBtcBenchmark() {
  const pool = getPool();
  const modelId = BASELINE_MODEL_ID;
  const storageSymbol = ensureMarketSymbol("BTC");

  try {
    const runtime = await getRuntimeAccount(modelId);
    const quantity = Number(runtime?.metadata?.benchmark_quantity ?? 0);
    const entryPrice = Number(runtime?.metadata?.benchmark_entry_price ?? 0);
    if (!runtime || !quantity || !entryPrice) {
      return null;
    }
    const priceResult = await pool.query(
      `SELECT price FROM market_prices WHERE symbol = $1 ORDER BY updated_at DESC LIMIT 1`,
      [storageSymbol]
    );
    let currentPrice = toNumber(priceResult.rows[0]?.price ?? entryPrice);
    if (!currentPrice) {
      const snapshot = await getMarketSnapshot();
      currentPrice = toNumber(snapshot.prices.BTC?.price ?? entryPrice);
    }

    const currentNotional = currentPrice * quantity;
    const unrealizedPnl = currentNotional - entryPrice * quantity;
    const equity = currentNotional;

    await upsertRuntimeAccount(modelId, {
      starting_equity: runtime.starting_equity ?? entryPrice * quantity,
      latest_equity: equity,
      available_cash: 0,
      total_unrealized_pnl: unrealizedPnl,
      metadata: runtime.metadata,
    });

    await appendAccountTimeseries({
      modelId,
      ts: new Date(),
      equity,
      cash_available: 0,
      unrealized_pnl: unrealizedPnl,
      realized_pnl: 0,
      sharpe: 0,
      win_rate: 0,
    });

    return {
      modelId,
      currentPrice,
      quantity,
      equity,
      unrealizedPnl,
      returnPercent:
        entryPrice && quantity
          ? ((equity / (entryPrice * quantity)) - 1) * 100
          : 0,
    };
  } catch (error) {
    console.error("BTC benchmark update failed:", error);
    throw error;
  }
}

export async function insertMarketPriceSnapshot(snapshot) {
  const pool = getPool();
  const {
    symbol,
    timeframe,
    ts,
    price_mid,
    ema20,
    ema50,
    macd,
    rsi_7,
    rsi_14,
    open_interest,
    open_interest_avg,
    funding_rate,
    volume,
    volume_avg,
    atr_3,
    atr_14,
    ema20_htf,
    ema50_htf,
  } = snapshot;

  if (!symbol || !timeframe || !ts) {
    throw new Error("symbol, timeframe and ts are required for market_price_history snapshot.");
  }
  const storageSymbol = ensureMarketSymbol(symbol);

  await pool.query(
    `
    INSERT INTO market_price_history (
      symbol, timeframe, ts, price_mid, ema20, ema50, macd, rsi_7, rsi_14,
      open_interest, open_interest_avg, funding_rate, volume, volume_avg,
      atr_3, atr_14, ema20_htf, ema50_htf
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    ON CONFLICT (symbol, timeframe, ts) DO NOTHING
    `,
    [
      storageSymbol,
      timeframe,
      new Date(ts),
      price_mid != null ? toNumber(price_mid) : null,
      ema20 != null ? toNumber(ema20) : null,
      ema50 != null ? toNumber(ema50) : null,
      macd != null ? toNumber(macd) : null,
      rsi_7 != null ? toNumber(rsi_7) : null,
      rsi_14 != null ? toNumber(rsi_14) : null,
      open_interest != null ? toNumber(open_interest) : null,
      open_interest_avg != null ? toNumber(open_interest_avg) : null,
      funding_rate != null ? toNumber(funding_rate) : null,
      volume != null ? toNumber(volume) : null,
      volume_avg != null ? toNumber(volume_avg) : null,
      atr_3 != null ? toNumber(atr_3) : null,
      atr_14 != null ? toNumber(atr_14) : null,
      ema20_htf != null ? toNumber(ema20_htf) : null,
      ema50_htf != null ? toNumber(ema50_htf) : null,
    ]
  );
}

export async function upsertMarketPrice(row) {
  const pool = getPool();
  const {
    symbol,
    price,
    change_percent = null,
    high_price = null,
    low_price = null,
    volume = null,
    volume_avg = null,
    ema20 = null,
    ema50 = null,
    macd = null,
    rsi_7 = null,
    rsi_14 = null,
    open_interest = null,
    open_interest_avg = null,
    funding_rate = null,
    atr_3 = null,
    atr_14 = null,
    ema20_htf = null,
    ema50_htf = null,
    macd_htf = null,
    rsi_14_htf = null,
    last_update_ts = null,
    raw_payload = null,
  } = row;

  if (!symbol) {
    throw new Error("symbol is required to upsert market price.");
  }
  const storageSymbol = ensureMarketSymbol(symbol);

  await pool.query(
    `
    INSERT INTO market_prices (
      symbol, price, change_percent, high_price, low_price, volume, volume_avg,
      ema20, ema50, macd, rsi_7, rsi_14, open_interest, open_interest_avg,
      funding_rate, atr_3, atr_14, ema20_htf, ema50_htf, macd_htf, rsi_14_htf,
      last_update_ts, raw_payload, updated_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,
      $8,$9,$10,$11,$12,$13,
      $14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23, now()
    )
    ON CONFLICT (symbol) DO UPDATE SET
      price = EXCLUDED.price,
      change_percent = EXCLUDED.change_percent,
      high_price = EXCLUDED.high_price,
      low_price = EXCLUDED.low_price,
      volume = EXCLUDED.volume,
      volume_avg = COALESCE(EXCLUDED.volume_avg, market_prices.volume_avg),
      ema20 = COALESCE(EXCLUDED.ema20, market_prices.ema20),
      ema50 = COALESCE(EXCLUDED.ema50, market_prices.ema50),
      macd = COALESCE(EXCLUDED.macd, market_prices.macd),
      rsi_7 = COALESCE(EXCLUDED.rsi_7, market_prices.rsi_7),
      rsi_14 = COALESCE(EXCLUDED.rsi_14, market_prices.rsi_14),
      open_interest = COALESCE(EXCLUDED.open_interest, market_prices.open_interest),
      open_interest_avg = COALESCE(EXCLUDED.open_interest_avg, market_prices.open_interest_avg),
      funding_rate = COALESCE(EXCLUDED.funding_rate, market_prices.funding_rate),
      atr_3 = COALESCE(EXCLUDED.atr_3, market_prices.atr_3),
      atr_14 = COALESCE(EXCLUDED.atr_14, market_prices.atr_14),
      ema20_htf = COALESCE(EXCLUDED.ema20_htf, market_prices.ema20_htf),
      ema50_htf = COALESCE(EXCLUDED.ema50_htf, market_prices.ema50_htf),
      macd_htf = COALESCE(EXCLUDED.macd_htf, market_prices.macd_htf),
      rsi_14_htf = COALESCE(EXCLUDED.rsi_14_htf, market_prices.rsi_14_htf),
      last_update_ts = EXCLUDED.last_update_ts,
      raw_payload = EXCLUDED.raw_payload,
      updated_at = now()
    `,
    [
      storageSymbol,
      price != null ? toNumber(price) : null,
      change_percent != null ? toNumber(change_percent) : null,
      high_price != null ? toNumber(high_price) : null,
      low_price != null ? toNumber(low_price) : null,
      volume != null ? toNumber(volume) : null,
      volume_avg != null ? toNumber(volume_avg) : null,
      ema20 != null ? toNumber(ema20) : null,
      ema50 != null ? toNumber(ema50) : null,
      macd != null ? toNumber(macd) : null,
      rsi_7 != null ? toNumber(rsi_7) : null,
      rsi_14 != null ? toNumber(rsi_14) : null,
      open_interest != null ? toNumber(open_interest) : null,
      open_interest_avg != null ? toNumber(open_interest_avg) : null,
      funding_rate != null ? toNumber(funding_rate) : null,
      atr_3 != null ? toNumber(atr_3) : null,
      atr_14 != null ? toNumber(atr_14) : null,
      ema20_htf != null ? toNumber(ema20_htf) : null,
      ema50_htf != null ? toNumber(ema50_htf) : null,
      macd_htf != null ? toNumber(macd_htf) : null,
      rsi_14_htf != null ? toNumber(rsi_14_htf) : null,
      last_update_ts ? new Date(last_update_ts) : null,
      raw_payload != null ? raw_payload : null,
    ]
  );
}

export async function getMarketSeries(symbol, timeframe, options = {}) {
  const pool = getPool();
  const { from, to, limit = 500 } = options ?? {};
  const storageSymbol = ensureMarketSymbol(symbol);
  const filters = ["symbol = $1", "timeframe = $2"];
  const params = [storageSymbol, timeframe];
  let idx = params.length + 1;

  if (from) {
    filters.push(`ts >= $${idx}`);
    params.push(new Date(from));
    idx += 1;
  }

  if (to) {
    filters.push(`ts <= $${idx}`);
    params.push(new Date(to));
    idx += 1;
  }

  let limitClause = "";
  if (limit) {
    limitClause = `LIMIT $${idx}`;
    params.push(Number(limit));
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const { rows } = await pool.query(
    `
    SELECT
      ts,
      price_mid,
      ema20,
      macd,
      rsi_7,
      rsi_14,
      open_interest,
      funding_rate,
      volume,
      atr_3,
      atr_14,
      ema20_htf,
      ema50_htf
    FROM market_price_history
    ${whereClause}
    ORDER BY ts ASC
    ${limit ? limitClause : ""}
    `,
    params
  );

  return rows.map((row) => ({
    ts: row.ts.getTime(),
    price_mid: row.price_mid != null ? toNumber(row.price_mid) : null,
    ema20: row.ema20 != null ? toNumber(row.ema20) : null,
    macd: row.macd != null ? toNumber(row.macd) : null,
    rsi_7: row.rsi_7 != null ? toNumber(row.rsi_7) : null,
    rsi_14: row.rsi_14 != null ? toNumber(row.rsi_14) : null,
    open_interest: row.open_interest != null ? toNumber(row.open_interest) : null,
    funding_rate: row.funding_rate != null ? toNumber(row.funding_rate) : null,
    volume: row.volume != null ? toNumber(row.volume) : null,
    atr_3: row.atr_3 != null ? toNumber(row.atr_3) : null,
    atr_14: row.atr_14 != null ? toNumber(row.atr_14) : null,
    ema20_htf: row.ema20_htf != null ? toNumber(row.ema20_htf) : null,
    ema50_htf: row.ema50_htf != null ? toNumber(row.ema50_htf) : null,
  }));
}

export async function listAgentModels(options = {}) {
  const { includeDisabled = true, includeSecrets = true } = options;
  const pool = getPool();
  await ensurePromptTemplateSchema();
  const { rows } = await pool.query(
    `
    SELECT
      m.*,
      a.starting_equity AS account_starting_equity,
      a.latest_equity AS account_latest_equity,
      a.available_cash AS account_available_cash,
      a.total_unrealized_pnl AS account_total_unrealized_pnl,
      t.template_name AS prompt_template_name,
      t.placeholder_tokens AS prompt_template_tokens,
      t.is_default AS prompt_template_is_default,
      t.sample_market_state_text AS prompt_template_sample_market_state,
      t.sample_position_state_text AS prompt_template_sample_position,
      t.system_prompt AS prompt_template_system_prompt,
      t.user_prompt AS prompt_template_user_prompt
    FROM agent_models m
    LEFT JOIN agent_accounts_runtime a ON a.model_id = m.model_id
    LEFT JOIN prompt_templates t ON t.id = m.prompt_template_id
    ORDER BY m.display_name, m.model_id
    `
  );

  return rows.map((row) => mapModelRow(row, { includeSecrets }));
}

export async function getAgentModelById(modelId, { includeSecrets = true } = {}) {
  const pool = getPool();
  await ensurePromptTemplateSchema();
  const { rows } = await pool.query(
    `
    SELECT
      m.*,
      a.starting_equity AS account_starting_equity,
      a.latest_equity AS account_latest_equity,
      a.available_cash AS account_available_cash,
      a.total_unrealized_pnl AS account_total_unrealized_pnl,
      t.template_name AS prompt_template_name,
      t.placeholder_tokens AS prompt_template_tokens,
      t.is_default AS prompt_template_is_default,
      t.sample_market_state_text AS prompt_template_sample_market_state,
      t.sample_position_state_text AS prompt_template_sample_position,
      t.system_prompt AS prompt_template_system_prompt,
      t.user_prompt AS prompt_template_user_prompt
    FROM agent_models m
    LEFT JOIN agent_accounts_runtime a ON a.model_id = m.model_id
    LEFT JOIN prompt_templates t ON t.id = m.prompt_template_id
    WHERE m.model_id = $1
    `,
    [modelId]
  );
  if (!rows.length) return null;
  return mapModelRow(rows[0], { includeSecrets });
}

async function resolvePromptTemplate(templateId) {
  if (templateId) {
    const template = await getPromptTemplateById(templateId);
    if (!template) {
      throw new Error("指定的提示词模板不存在。");
    }
    return template;
  }
  const fallback = await getDefaultPromptTemplate();
  if (!fallback) {
    throw new Error("尚未配置默认提示词模板。");
  }
  return fallback;
}

export async function createAgentModel(payload) {
  const pool = getPool();

  const {
    model_id,
    display_name,
    api_base_url,
    api_key,
    human_review_required = false,
    prompt_template_id = null,
    auto_run_enabled = false,
    auto_run_interval_minutes = 5,
    display_icon = DEFAULT_MODEL_ICON,
    margin_config = {},
  } = payload;

  const template = await resolvePromptTemplate(prompt_template_id);

  const sanitizedInterval = Number.isFinite(Number(auto_run_interval_minutes))
    ? Math.max(1, Number(auto_run_interval_minutes))
    : 5;
  const startingEquity = 10000;

  const { rows } = await pool.query(
    `
    INSERT INTO agent_models (
      model_id,
      display_name,
      api_base_url,
      api_key,
      human_review_required,
      prompt_template_id,
      auto_run_enabled,
      auto_run_interval_minutes,
      display_icon,
      margin_config
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *
    `,
    [
      model_id,
      display_name,
      api_base_url ?? null,
      api_key ?? null,
      human_review_required,
      template.id ?? null,
      Boolean(auto_run_enabled),
      sanitizedInterval,
      display_icon ?? DEFAULT_MODEL_ICON,
      margin_config ?? {},
    ]
  );

  await upsertRuntimeAccount(model_id, {
    starting_equity: startingEquity,
    latest_equity: startingEquity,
    available_cash: startingEquity,
    total_unrealized_pnl: 0,
  });

  await appendAccountTimeseries({
    modelId: model_id,
    ts: new Date(),
    equity: startingEquity,
    cash_available: startingEquity,
    unrealized_pnl: 0,
    realized_pnl: 0,
  });

  return mapModelRow(rows[0]);
}

export async function updateAgentModel(modelId, updates) {
  const pool = getPool();
  const allowed = {
    display_name: "display_name",
    api_base_url: "api_base_url",
    api_key: "api_key",
    human_review_required: "human_review_required",
    prompt_template_id: "prompt_template_id",
    auto_run_enabled: "auto_run_enabled",
    auto_run_interval_minutes: "auto_run_interval_minutes",
    display_icon: "display_icon",
    last_auto_run_at: "last_auto_run_at",
    next_auto_run_at: "next_auto_run_at",
    margin_config: "margin_config",
  };

  const nextUpdates = { ...updates };

  if (Object.prototype.hasOwnProperty.call(nextUpdates, "prompt_template_id")) {
    if (nextUpdates.prompt_template_id) {
      const template = await getPromptTemplateById(nextUpdates.prompt_template_id);
      if (!template) {
        throw new Error("指定的提示词模板不存在。");
      }
      nextUpdates.prompt_template_id = template.id;
    } else {
      nextUpdates.prompt_template_id = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(nextUpdates, "auto_run_enabled")) {
    nextUpdates.auto_run_enabled = Boolean(nextUpdates.auto_run_enabled);
  }

  if (Object.prototype.hasOwnProperty.call(nextUpdates, "auto_run_interval_minutes")) {
    const parsed = Number(nextUpdates.auto_run_interval_minutes);
    nextUpdates.auto_run_interval_minutes =
      Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.round(parsed)) : 5;
  }

  const fields = [];
  const values = [];
  let idx = 1;

  Object.entries(nextUpdates).forEach(([key, value]) => {
    const column = allowed[key];
    if (!column) return;
    let transformed = value;
    if (column === "last_auto_run_at" || column === "next_auto_run_at") {
      transformed = value ? new Date(value) : null;
    }
    fields.push(`${column} = $${idx}`);
    values.push(transformed);
    idx += 1;
  });

  if (!fields.length) {
    logger.info("dataRepository", "updateAgentModel no fields changed", {
      modelId,
    });
    return getAgentModelById(modelId);
  }

  fields.push(`updated_at = now()`);

  values.push(modelId);

  logger.info("dataRepository", "updateAgentModel query", {
    modelId,
    fields,
    values,
  });

  const { rows } = await pool.query(
    `
    UPDATE agent_models
    SET ${fields.join(", ")}
    WHERE model_id = $${values.length}
    RETURNING *
    `,
    values
  );

  logger.info("dataRepository", "updateAgentModel rows", rows);

  if (!rows.length) return null;
  return mapModelRow(rows[0]);
}

export async function deleteAgentModel(modelId) {
  const pool = getPool();
  await pool.query(
    `
    DELETE FROM agent_models
    WHERE model_id = $1
    `,
    [modelId]
  );
}

export async function markModelAutoRun(modelId, { lastRun = new Date(), intervalMinutes = 5 } = {}) {
  const pool = getPool();
  const last = lastRun ? new Date(lastRun) : new Date();
  const interval = Number(intervalMinutes) || 5;
  const next = new Date(last.getTime() + interval * 60 * 1000);
  await pool.query(
    `
    UPDATE agent_models
    SET last_auto_run_at = $2,
        next_auto_run_at = $3
    WHERE model_id = $1
    `,
    [modelId, last, next]
  );
}

export async function getAgentAccounts() {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT
      m.model_id,
      m.display_name,
      m.human_review_required,
      COALESCE(a.starting_equity, 10000) AS starting_equity,
      COALESCE(a.latest_equity, 10000) AS latest_equity,
      COALESCE(a.available_cash, COALESCE(a.latest_equity, 10000)) AS available_cash,
      COALESCE(a.total_unrealized_pnl, 0) AS total_unrealized_pnl,
      COALESCE(a.sharpe_ratio, 0) AS sharpe_ratio,
      COALESCE(a.win_rate, 0) AS win_rate,
      COALESCE(a.trade_count, 0) AS trade_count,
      a.metadata AS runtime_metadata,
      t.system_prompt AS template_system_prompt,
      t.user_prompt AS template_user_prompt
    FROM agent_models m
    LEFT JOIN agent_accounts_runtime a ON a.model_id = m.model_id
    LEFT JOIN prompt_templates t ON t.id = m.prompt_template_id
    ORDER BY m.display_name, m.model_id
    `
  );

  return rows.map(mapAccountRow);
}

export async function listPromptTemplates(options = {}) {
  const { includeContent = true } = options;
  const pool = getPool();
  await ensurePromptTemplateSchema();
  const { rows } = await pool.query(
    `
    SELECT *
    FROM prompt_templates
    ORDER BY template_name
    `
  );
  return rows.map((row) => mapPromptTemplateRow(row, { includeContent }));
}

export async function getPromptTemplateById(templateId, options = {}) {
  if (!templateId) return null;
  const { includeContent = true } = options;
  const pool = getPool();
  await ensurePromptTemplateSchema();
  const { rows } = await pool.query(
    `
    SELECT *
    FROM prompt_templates
    WHERE id = $1
    `,
    [templateId]
  );
  if (!rows.length) return null;
  return mapPromptTemplateRow(rows[0], { includeContent });
}

export async function getDefaultPromptTemplate(options = {}) {
  const { includeContent = true } = options;
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT *
    FROM prompt_templates
    WHERE is_default = TRUE
    ORDER BY updated_at DESC
    LIMIT 1
    `
  );
  if (rows.length) {
    return mapPromptTemplateRow(rows[0], { includeContent });
  }
  const fallback = await pool.query(
    `
    SELECT *
    FROM prompt_templates
    ORDER BY updated_at DESC
    LIMIT 1
    `
  );
  if (!fallback.rows.length) return null;
  return mapPromptTemplateRow(fallback.rows[0], { includeContent });
}

export async function createPromptTemplate(payload) {
  const pool = getPool();
  await ensurePromptTemplateSchema();
  const {
    template_name,
    description = "",
    system_prompt = "",
    user_prompt = "",
    placeholder_tokens,
    sample_market_state_text = "",
    sample_position_state_text = "",
    is_default = false,
  } = payload;

  if (!template_name || !template_name.trim()) {
    throw new Error("template_name 不能为空。");
  }

  const tokens =
    Array.isArray(placeholder_tokens) && placeholder_tokens.length
      ? [...new Set(placeholder_tokens)]
      : extractPlaceholderTokensFromText(system_prompt, user_prompt);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (is_default) {
      await client.query(`UPDATE prompt_templates SET is_default = FALSE WHERE is_default = TRUE`);
    }
    const { rows } = await client.query(
      `
      INSERT INTO prompt_templates (
        template_name,
        description,
        system_prompt,
        user_prompt,
        placeholder_tokens,
        sample_market_state_text,
        sample_position_state_text,
        is_default
      )
      VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8)
      RETURNING *
      `,
      [
        template_name.trim(),
        description ?? "",
        system_prompt,
        user_prompt,
        tokens,
        sample_market_state_text || null,
        sample_position_state_text || null,
        Boolean(is_default),
      ]
    );
    await client.query("COMMIT");
    return mapPromptTemplateRow(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePromptTemplate(templateId, updates) {
  if (!templateId) {
    throw new Error("templateId is required.");
  }
  const pool = getPool();
  await ensurePromptTemplateSchema();
  const existing = await getPromptTemplateById(templateId);
  if (!existing) {
    throw new Error("提示词模板不存在。");
  }

  const nextUpdates = { ...updates };
  if (!("placeholder_tokens" in nextUpdates)) {
    const nextSystem =
      typeof nextUpdates.system_prompt === "string"
        ? nextUpdates.system_prompt
        : existing.system_prompt;
    const nextUser =
      typeof nextUpdates.user_prompt === "string" ? nextUpdates.user_prompt : existing.user_prompt;
    nextUpdates.placeholder_tokens = extractPlaceholderTokensFromText(nextSystem, nextUser);
  }

  const allowed = {
    template_name: "template_name",
    description: "description",
    system_prompt: "system_prompt",
    user_prompt: "user_prompt",
    placeholder_tokens: "placeholder_tokens",
    sample_market_state_text: "sample_market_state_text",
    sample_position_state_text: "sample_position_state_text",
    is_default: "is_default",
  };

  const fields = [];
  const values = [];
  let idx = 1;

  Object.entries(nextUpdates).forEach(([key, value]) => {
    const column = allowed[key];
    if (!column) return;
    if (column === "template_name" && value && !value.trim()) {
      return;
    }
    fields.push(`${column} = $${idx}`);
    values.push(column === "template_name" ? value.trim() : value);
    idx += 1;
  });

  if (!fields.length) {
    return existing;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (nextUpdates.is_default === true) {
      await client.query(
        `UPDATE prompt_templates SET is_default = FALSE WHERE is_default = TRUE AND id <> $1`,
        [templateId]
      );
    }
    const { rows } = await client.query(
      `
      UPDATE prompt_templates
      SET ${fields.join(", ")}, updated_at = now()
      WHERE id = $${idx}
      RETURNING *
      `,
      [...values, templateId]
    );
    await client.query("COMMIT");
    if (!rows.length) {
      throw new Error("更新提示词模板失败。");
    }
    return mapPromptTemplateRow(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePromptTemplate(templateId) {
  if (!templateId) {
    throw new Error("templateId is required.");
  }
  const pool = getPool();
  const template = await getPromptTemplateById(templateId);
  if (!template) {
    return false;
  }
  if (template.is_default) {
    throw new Error("默认模板无法删除，请先取消默认状态。");
  }
  const { rows } = await pool.query(
    `
    SELECT COUNT(*)::int AS usage_count
    FROM agent_models
    WHERE prompt_template_id = $1
    `,
    [templateId]
  );
  if (rows[0].usage_count > 0) {
    throw new Error("仍有模型正在使用该模板，无法删除。");
  }
  await pool.query(
    `
    DELETE FROM prompt_templates
    WHERE id = $1
    `,
    [templateId]
  );
  return true;
}

export async function getSinceInceptionValues() {
  const pool = getPool();
  const models = await listAgentModels({ includeDisabled: true, includeSecrets: false });
  if (!models.length) return [];

  const [{ rows: inceptionRows }, { rows: logRows }] = await Promise.all([
    pool.query(
      `
      SELECT model_id, MIN(ts) AS inception_date
      FROM agent_account_timeseries
      GROUP BY model_id
      `
    ),
    pool.query(
      `
      SELECT model_id, COUNT(*)::int AS num_invocations
      FROM agent_logs
      GROUP BY model_id
      `
    ),
  ]);

  const inceptionMap = new Map(
    inceptionRows.map((row) => [row.model_id, row.inception_date ? row.inception_date.getTime() : null])
  );
  const logCountMap = new Map(logRows.map((row) => [row.model_id, Number(row.num_invocations ?? 0)]));

  return models.map((model) => ({
    id: `${model.model_id}-inception`,
    model_id: model.model_id,
    nav_since_inception: toNumber(model.latest_equity ?? model.starting_equity ?? 10000),
    inception_date:
      inceptionMap.get(model.model_id) ?? (model.created_at ? safeTimestamp(model.created_at) : null),
    num_invocations: logCountMap.get(model.model_id) ?? 0,
  }));
}

export async function getPerformanceTimeseries() {
  const pool = getPool();
  const accounts = await getAgentAccounts();
  const startingEquityMap = new Map(
    accounts.map((account) => [account.model_id, account.starting_equity ?? 10000])
  );

  const { rows } = await pool.query(
    `
    SELECT
      model_id,
      ts,
      equity,
      cash_available,
      unrealized_pnl,
      realized_pnl,
      sharpe,
      win_rate
    FROM agent_account_timeseries
    ORDER BY ts
    `
  );

  const historyByModel = rows.reduce((acc, row) => {
    if (!acc[row.model_id]) acc[row.model_id] = [];
    const equity = toNumber(row.equity ?? 0);
    const startingEquity = startingEquityMap.get(row.model_id) ?? 10000;
    const pnlRatio = startingEquity ? equity / startingEquity - 1 : null;
    acc[row.model_id].push({
      timestamp: row.ts.getTime(),
      ts: row.ts.getTime(),
      equity,
      dollar_equity: equity,
      cash_available: row.cash_available != null ? toNumber(row.cash_available) : null,
      unrealized_pnl: row.unrealized_pnl != null ? toNumber(row.unrealized_pnl) : null,
      realized_pnl: row.realized_pnl != null ? toNumber(row.realized_pnl) : null,
      sharpe: row.sharpe != null ? toNumber(row.sharpe) : null,
      win_rate: row.win_rate != null ? toNumber(row.win_rate) : null,
      cum_pnl_pct: pnlRatio != null ? Number(pnlRatio.toFixed(6)) : null,
    });
    return acc;
  }, {});

  const series = accounts.map((account) => ({
    model_id: account.model_id,
    name: account.display_name,
    line_key: account.model_id.replace(/[^a-z0-9]/gi, "_"),
    color: account.color,
    points: historyByModel[account.model_id] ?? [],
  }));

  const latestEquities = series.map((entry) => {
    const lastPoint = entry.points.at(-1);
    return {
      model_id: entry.model_id,
      equity: lastPoint ? lastPoint.equity : accounts.find((a) => a.model_id === entry.model_id)?.latest_equity ?? 0,
    };
  });

  const reference = latestEquities.length ? latestEquities[0] : { model_id: null, equity: 0 };
  const highest = latestEquities.reduce(
    (acc, cur) => (cur.equity > acc.equity ? cur : acc),
    reference
  );
  const lowest = latestEquities.reduce(
    (acc, cur) => (cur.equity < acc.equity ? cur : acc),
    reference
  );

  return {
    highest: { model_id: highest?.model_id ?? null },
    lowest: { model_id: lowest?.model_id ?? null },
    series,
  };
}

export async function getPositionsSnapshot() {
  const pool = getPool();
  const accounts = (await getAgentAccounts()).filter(
    (account) => account.model_id !== BASELINE_MODEL_ID
  );
  if (!accounts.length) return [];

  const modelIds = accounts.map((account) => account.model_id);
  const positionsByModel = await getOpenPositionsGrouped(modelIds);

  return accounts.map((account) => {
    const positions = positionsByModel.get(account.model_id) ?? [];
    const walletBalance =
      account.available_cash ??
      account.latest_equity ??
      account.starting_equity ??
      10000;
    const summary = summarizeMarginAccount(walletBalance, positions);

    return {
      model_id: account.model_id,
      timestamp: Date.now(),
      dollar_equity: summary.equity,
      total_unrealized_pnl: summary.totalUnrealized,
      cum_pnl_pct: account.pnl_pct,
      sharpe_ratio: account.sharpe_ratio,
      available_cash: summary.availableBalance,
      positions: Object.fromEntries(
        positions.map((pos) => [pos.id ?? `${pos.symbol}-${pos.entry_time ?? Date.now()}`, pos])
      ),
    };
  });
}

export async function markToMarketAllModels() {
  const accounts = await getAgentAccounts();
  if (!accounts.length) return { updated: [] };

  const tradable = accounts.filter((account) => account.model_id !== BASELINE_MODEL_ID);
  if (!tradable.length) {
    return { updated: [], snapshots: [] };
  }

  const modelIds = tradable.map((account) => account.model_id);
  const positionsByModel = await getOpenPositionsGrouped(modelIds);
  const fundingConfig = getFundingConfig();
  let fundingRates = {};
  if (fundingConfig.enabled) {
    const snapshot = await getMarketSnapshot();
    fundingRates = buildFundingRateMap(snapshot);
  }

  const updatedModels = [];
  const equitySnapshots = [];
  const now = new Date();

  for (const account of tradable) {
    let modelPositions = positionsByModel.get(account.model_id) ?? [];
    let walletBalance = toNumber(
      account.available_cash ??
        account.latest_equity ??
        account.starting_equity ??
        10000
    );
    logger.info("mtm.account.start", {
      model_id: account.model_id,
      starting_equity: account.starting_equity,
      latest_equity_before: account.latest_equity,
      wallet_balance_before: account.wallet_balance ?? account.available_cash,
      available_cash_before: account.available_cash,
      total_unrealized_pnl_before: account.total_unrealized_pnl,
      trade_count: account.trade_count,
    });
    const { realizedDelta, feesPaid } = await enforceExitTargets(
      account.model_id,
      modelPositions
    );
    if (realizedDelta !== 0) {
      walletBalance += realizedDelta;
      modelPositions = await getOpenPositions(account.model_id);
    }
    if (feesPaid) {
      walletBalance = Math.max(0, walletBalance - feesPaid);
    }
    let metadata = account.metadata ?? {};
    if (fundingConfig.enabled) {
      const fundingResult = applyFundingSettlements(
        { ...account, metadata },
        modelPositions,
        fundingRates,
        fundingConfig,
        now.getTime()
      );
      if (fundingResult.walletDelta) {
        walletBalance += fundingResult.walletDelta;
      }
      metadata = fundingResult.metadata;
    }
    let summary = summarizeMarginAccount(walletBalance, modelPositions);
    let positionMargin = summary.totalInitialMargin;
    let marginBySymbol = { ...(summary.marginBySymbol ?? {}) };
    const startingEquity = toNumber(account.starting_equity ?? walletBalance);
    logger.info("mtm.account.afterRisk", {
      model_id: account.model_id,
      wallet_balance_after_exits_and_funding: walletBalance,
      metadata_after_funding: metadata,
      summary_equity: summary.equity,
      summary_unrealized: summary.totalUnrealized,
      summary_available_balance: summary.availableBalance,
    });

    try {
      const liquidationCheck = await runLiquidationCheckForAccount(
        {
          ...account,
          wallet_balance: summary.walletBalance,
          position_margin: positionMargin,
          total_unrealized_pnl: summary.totalUnrealized,
        },
        modelPositions,
        { getMarkPrice }
      );
      logger.info("mtm.liquidation.check", {
        model_id: account.model_id,
        action: liquidationCheck?.action,
        requiredLoss: liquidationCheck?.details?.requiredLoss,
        coveredByUserMargin: liquidationCheck?.details?.coveredByUserMargin,
        coveredByInsurance: liquidationCheck?.details?.coveredByInsurance,
        adlLoss: liquidationCheck?.details?.adlLoss,
      });
      if (liquidationCheck?.action && liquidationCheck.action !== "hold") {
        logger.info("mtm.liquidation.triggered", {
          model_id: account.model_id,
          action: liquidationCheck.action,
          details: liquidationCheck.details,
        });
        const details = liquidationCheck.details ?? {};
        const closeList = Array.isArray(details.positionsToClose)
          ? details.positionsToClose
          : [];
        for (const item of closeList) {
          const symbol = item?.symbol ?? item?.position?.symbol;
          if (!symbol) continue;
          const exitPrice =
            item?.markPrice ??
            item?.liquidationPrice ??
            (await getMarkPrice(symbol));
          if (!Number.isFinite(exitPrice)) continue;
          const result = await closeOpenTrades(
            account.model_id,
            symbol,
            exitPrice,
            {
              liquidationType: details.mode ?? null,
              liquidationPrice: item?.liquidationPrice ?? exitPrice,
              adl: Boolean(details.adl),
            }
          );
          if (result.closed > 0) {
            walletBalance += result.realizedPnl ?? 0;
            if (result.feesPaid) {
              walletBalance = Math.max(0, walletBalance - result.feesPaid);
            }
            const released = result.releasedMargin ?? 0;
            if ((details.mode ?? "").toLowerCase() === "isolated") {
              const key = String(symbol).toUpperCase();
              marginBySymbol[key] = Math.max(
                0,
                (marginBySymbol[key] ?? 0) - released
              );
            } else {
              positionMargin = Math.max(0, positionMargin - released);
            }
          }
        }
        modelPositions = await getOpenPositions(account.model_id);
        summary = summarizeMarginAccount(walletBalance, modelPositions);
        positionMargin = summary.totalInitialMargin;
        marginBySymbol = { ...(summary.marginBySymbol ?? {}) };

        const adlLoss = Number(details.adlLoss ?? 0);
        if (adlLoss > 0) {
          try {
            const adlResult = await distributeAdlLoss(adlLoss);
            logger.info("adlEngine", "ADL distributed", adlResult);
          } catch (adlError) {
            logger.error("adlEngine", "ADL distribution failed", {
              model_id: account.model_id,
              error: adlError?.message,
            });
          }
        }
      }
    } catch (error) {
      console.error("[liquidation] execution failed", {
        model_id: account.model_id,
        error: error?.message,
      });
    }

    const availableCash = walletBalance - positionMargin;
    const latestEquity = walletBalance + summary.totalUnrealized;
    const realizedPnl = walletBalance - startingEquity;

    await upsertRuntimeAccount(account.model_id, {
      starting_equity: account.starting_equity,
      latest_equity: latestEquity,
      available_cash: availableCash,
      total_unrealized_pnl: summary.totalUnrealized,
      trade_count: account.total_trades ?? 0,
      sharpe_ratio: account.sharpe_ratio,
      win_rate: account.win_rate,
      metadata,
      wallet_balance: walletBalance,
      position_margin: positionMargin,
    });

    equitySnapshots.push({
      model_id: account.model_id,
      latest_equity: latestEquity,
      cash_available: availableCash,
      total_unrealized_pnl: summary.totalUnrealized,
      timestamp: now.getTime(),
    });

    await appendAccountTimeseries({
      modelId: account.model_id,
      ts: now,
      equity: latestEquity,
      cash_available: availableCash,
      unrealized_pnl: summary.totalUnrealized,
      realized_pnl: realizedPnl,
      sharpe: account.sharpe_ratio,
      win_rate: account.win_rate,
    });
    logger.info("mtm.account.end", {
      model_id: account.model_id,
      latest_equity_after: latestEquity,
      wallet_balance_after: walletBalance,
      available_cash_after: availableCash,
      total_unrealized_pnl_after: summary.totalUnrealized,
    });

    updatedModels.push(account.model_id);
  }

  return { updated: updatedModels, snapshots: equitySnapshots };
}

/**
 * Fetch recent log entries for UI timelines / log console.
 * agent_logs acts as the unified audit trail (pending decisions, approvals, executions).
 */
export async function getAgentLogs(limit = 20) {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT id, model_id, public_message, cot_trace_summary, prompt_text, response_text, response_json, reasoning_content, created_at
    FROM agent_logs
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return rows.map((row) => ({
    id: row.id,
    model_id: row.model_id,
    timestamp: safeTimestamp(row.created_at),
    public_message: row.public_message ?? "",
    cot_trace_summary: row.cot_trace_summary ?? "",
    prompt_text: row.prompt_text ?? "",
    response_text: row.response_text ?? "",
    response_json: row.response_json ?? {},
    reasoning_content: row.reasoning_content ?? "",
  }));
}

export async function getRecentTrades(limit = 20) {
  const pool = getPool();
  try {
    const { rows } = await pool.query(
      `
      SELECT id, model_id, symbol, side, leverage, quantity, entry_price, exit_price,
             entry_time, exit_time, holding_time, realized_net_pnl, decision_source,
             exit_plan
      FROM trades
      ORDER BY entry_time DESC NULLS LAST, id DESC
      LIMIT $1
      `,
      [limit]
    );

    return rows.map((row) => ({
      id: row.id,
      model_id: row.model_id,
      symbol: row.symbol,
      side: row.side,
      leverage: toNumber(row.leverage ?? 0),
      quantity: toNumber(row.quantity ?? 0),
      entry_price: toNumber(row.entry_price ?? 0),
      exit_price: toNumber(row.exit_price ?? 0),
      entry_time: row.entry_time ? row.entry_time.getTime() : null,
      exit_time: row.exit_time ? row.exit_time.getTime() : null,
      entry_human_time: row.entry_time?.toISOString().replace("T", " ").replace("Z", ""),
      exit_human_time: row.exit_time?.toISOString().replace("T", " ").replace("Z", ""),
      holding_time: row.holding_time,
      realized_net_pnl: toNumber(row.realized_net_pnl ?? 0),
      decision_source: row.decision_source,
      exit_plan: row.exit_plan ?? {},
    }));
  } catch (error) {
    if (error?.code === "42P01") {
      console.warn("[dataRepository] trades表缺失，返回空列表。");
      return [];
    }
    throw error;
  }
}

export async function getTradesHistory({ page = 1, pageSize = 50, from, to }) {
  const pool = getPool();
  const offset = (page - 1) * pageSize;
  const baseParams = [pageSize, offset];
  const timeParams = [];

  let timeFilter = "";
  if (from || to) {
    const startIndex = baseParams.length + 1;
    timeFilter = `WHERE exit_time BETWEEN $${startIndex} AND $${startIndex + 1}`;
    timeParams.push(from ? new Date(from) : new Date(0));
    timeParams.push(to ? new Date(to) : new Date());
  }

  const params = [...baseParams, ...timeParams];
  const { rows } = await pool.query(
    `
    SELECT id, model_id, symbol, side, leverage, quantity, entry_price, exit_price,
           entry_time, exit_time, holding_time, realized_net_pnl, decision_source,
           exit_plan
    FROM trades
    ${timeFilter}
    ORDER BY exit_time DESC
    LIMIT $1 OFFSET $2
    `,
    params
  );

  const totalRes = await pool.query(
    `SELECT COUNT(*) FROM trades ${timeFilter}`,
    timeParams
  );

  return {
    trades: rows.map((row) => ({
      id: row.id,
      model_id: row.model_id,
      symbol: row.symbol,
      side: row.side,
      leverage: toNumber(row.leverage ?? 0),
      quantity: toNumber(row.quantity ?? 0),
      entry_price: toNumber(row.entry_price ?? 0),
      exit_price: toNumber(row.exit_price ?? 0),
      entry_time: row.entry_time?.getTime() ?? null,
      exit_time: row.exit_time?.getTime() ?? null,
      entry_human_time: row.entry_time?.toISOString().replace("T", " ").replace("Z", ""),
      exit_human_time: row.exit_time?.toISOString().replace("T", " ").replace("Z", ""),
      holding_time: row.holding_time,
      realized_net_pnl: toNumber(row.realized_net_pnl ?? 0),
      decision_source: row.decision_source,
      exit_plan: row.exit_plan ?? {},
    })),
    page,
    pageSize,
    total: Number(totalRes.rows[0]?.count ?? 0),
  };
}

function normalizePendingDecision(row) {
  const blob = row.decision_blob ?? {};
  const insertedAt = row.created_at ? safeTimestamp(row.created_at) : null;
  return {
    id: row.id,
    model_id: row.model_id,
    model_name: row.display_name ?? row.model_id,
    decision_blob: blob,
    inserted_at: insertedAt,
    status: row.review_status ?? "logged",
    decision_type: blob.decision_type ?? blob.source ?? null,
    target_symbol: blob.target_symbol ?? null,
    auto_executed: Boolean(
      blob.auto_executed ?? blob.autoApproved ?? row.review_status === "approved"
    ),
    reasoning_content: row.reasoning_content ?? null,
  };
}

/**
 * List agent_logs entries waiting for human review (review_status='pending').
 * Joined with agent_models to expose the display name for UI.
 */
export async function getPendingDecisions() {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT
      l.*,
      m.display_name
    FROM agent_logs l
    LEFT JOIN agent_models m ON m.model_id = l.model_id
    WHERE l.review_status = 'pending'
    ORDER BY l.created_at DESC
    `
  );

  return rows.map(normalizePendingDecision);
}

export async function getPendingDecisionById(decisionId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT
      l.*,
      m.display_name
    FROM agent_logs l
    LEFT JOIN agent_models m ON m.model_id = l.model_id
    WHERE l.id = $1
    `,
    [decisionId]
  );
  if (!rows.length) return null;
  return normalizePendingDecision(rows[0]);
}

/**
 * Persist an LLM decision payload into agent_logs for later approval/execution.
 * Stores prompt/response snapshots and ties the row to an optional cycle_id.
 */
export async function createPendingDecision(
  modelId,
  decisionBlob,
  status = "pending",
  insertedAt = new Date(),
  options = {}
) {
  const pool = getPool();
  const mergedBlob = {
    ...(decisionBlob ?? {}),
    decision_type: options.decision_type ?? decisionBlob?.decision_type ?? null,
    target_symbol: options.target_symbol ?? decisionBlob?.target_symbol ?? null,
    auto_executed: options.auto_executed ?? decisionBlob?.auto_executed ?? false,
  };
  const responseJson =
    mergedBlob.response_json ?? mergedBlob.decisions ?? decisionBlob?.response_json ?? null;
  const sanitizedBlob = sanitizeJsonValue(mergedBlob) ?? {};
  const sanitizedResponse =
    responseJson != null ? sanitizeJsonValue(responseJson) : null;
  const decisionBlobParam = JSON.stringify(sanitizedBlob);
  const responseJsonParam =
    sanitizedResponse != null ? JSON.stringify(sanitizedResponse) : null;
  const cycleId =
    options.cycle_id != null && Number.isFinite(Number(options.cycle_id))
      ? Number(options.cycle_id)
      : null;
  const reasoningContent = options.reasoning_content ?? mergedBlob.reasoning ?? null;
  const { rows } = await pool.query(
    `
    INSERT INTO agent_logs (
      model_id,
      public_message,
      cot_trace_summary,
      prompt_text,
      response_text,
      response_json,
      decision_blob,
      reasoning_content,
      cycle_id,
      review_status,
      created_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING
      *,
      (SELECT display_name FROM agent_models WHERE model_id = agent_logs.model_id) AS display_name
    `,
    [
      modelId,
      options.public_message ?? "Decision requires human approval.",
      options.cot_trace_summary ?? "Pending review",
      mergedBlob.prompt_text ?? null,
      mergedBlob.response_text ?? null,
      responseJsonParam ?? null,
      decisionBlobParam,
      reasoningContent ?? null,
      cycleId,
      status,
      insertedAt instanceof Date ? insertedAt : new Date(insertedAt),
    ]
  );
  return normalizePendingDecision(rows[0]);
}

/**
 * Update review_status (approved/rejected) for a pending log entry.
 * Also stamps reviewed_at for audit purposes and returns normalized row.
 */
export async function updatePendingDecisionStatus(decisionId, status, updates = {}) {
  const pool = getPool();
  const sanitizedResponse =
    updates.response_json != null ? sanitizeJsonValue(updates.response_json) : null;
  const responseJsonParam =
    sanitizedResponse != null ? JSON.stringify(sanitizedResponse) : null;
  const sanitizedBlob =
    updates.decision_blob != null ? sanitizeJsonValue(updates.decision_blob) : null;
  const decisionBlobParam =
    sanitizedBlob != null ? JSON.stringify(sanitizedBlob) : null;
  const reasoningContent =
    updates.reasoning_content != null ? updates.reasoning_content : null;
  const { rows } = await pool.query(
    `
    UPDATE agent_logs
    SET review_status = $2,
        reviewed_at = now(),
        public_message = COALESCE($3, public_message),
        cot_trace_summary = COALESCE($4, cot_trace_summary),
        account_value_snapshot = COALESCE($5, account_value_snapshot),
        sharpe_snapshot = COALESCE($6, sharpe_snapshot),
        response_json = COALESCE($7, response_json),
        decision_blob = COALESCE($8, decision_blob),
        reasoning_content = COALESCE($9, reasoning_content)
    WHERE id = $1
    RETURNING
      *,
      (SELECT display_name FROM agent_models WHERE model_id = agent_logs.model_id) AS display_name
    `,
    [
      decisionId,
      status,
      updates.public_message ?? null,
      updates.cot_trace_summary ?? null,
      updates.account_value_snapshot != null ? toNumber(updates.account_value_snapshot) : null,
      updates.sharpe_snapshot != null ? toNumber(updates.sharpe_snapshot) : null,
      responseJsonParam,
      decisionBlobParam,
      reasoningContent,
    ]
  );
  if (!rows.length) return null;

  return normalizePendingDecision(rows[0]);
}

export async function listEnabledAgentModels() {
  return listAgentModels({ includeDisabled: false, includeSecrets: true });
}

export async function getRuntimeAccount(modelId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT
      model_id,
      starting_equity,
      latest_equity,
      available_cash,
      total_unrealized_pnl,
      sharpe_ratio,
      win_rate,
      trade_count,
      metadata,
      updated_at
    FROM agent_accounts_runtime
    WHERE model_id = $1
    `,
    [modelId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    model_id: row.model_id,
    starting_equity: toNumber(row.starting_equity ?? 10000),
    latest_equity: toNumber(row.latest_equity ?? 10000),
    available_cash: toNumber(row.available_cash ?? 0),
    total_unrealized_pnl: toNumber(row.total_unrealized_pnl ?? 0),
    sharpe_ratio: toNumber(row.sharpe_ratio ?? 0),
    win_rate: toNumber(row.win_rate ?? 0),
    trade_count: Number(row.trade_count ?? 0),
    updated_at: safeTimestamp(row.updated_at),
    metadata: row.metadata ?? {},
  };
}

export async function upsertRuntimeAccount(modelId, payload) {
  const pool = getPool();
  const startingEquity = toNumber(payload.starting_equity ?? 10000);
  const latestEquity = toNumber(payload.latest_equity ?? startingEquity);
  const availableCash = toNumber(payload.available_cash ?? latestEquity);
  const totalUnrealized = toNumber(payload.total_unrealized_pnl ?? 0);
  const sharpe = toNumber(payload.sharpe_ratio ?? 0);
  const winRate = toNumber(payload.win_rate ?? 0);
  const tradeCount = Number(payload.trade_count ?? 0);
  const metadata =
    payload.metadata !== undefined ? payload.metadata : undefined;
  const metadataValue =
    metadata === undefined ? undefined : metadata ?? null;
  const metadataJson =
    metadataValue === undefined || metadataValue === null
      ? null
      : JSON.stringify(metadataValue);

  await pool.query(
    `
    INSERT INTO agent_accounts_runtime (
      model_id,
      starting_equity,
      latest_equity,
      available_cash,
      total_unrealized_pnl,
      sharpe_ratio,
      win_rate,
      trade_count,
      metadata,
      updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
    ON CONFLICT (model_id) DO UPDATE SET
      latest_equity = EXCLUDED.latest_equity,
      available_cash = EXCLUDED.available_cash,
      total_unrealized_pnl = EXCLUDED.total_unrealized_pnl,
      sharpe_ratio = EXCLUDED.sharpe_ratio,
      win_rate = EXCLUDED.win_rate,
      trade_count = EXCLUDED.trade_count,
      metadata = COALESCE(EXCLUDED.metadata, agent_accounts_runtime.metadata),
      updated_at = EXCLUDED.updated_at
    `,
    [
      modelId,
      startingEquity,
      latestEquity,
      availableCash,
      totalUnrealized,
      sharpe,
      winRate,
      tradeCount,
      metadataJson,
    ]
  );
}

export async function appendAccountTimeseries(entry) {
  const pool = getPool();
  const {
    modelId,
    model_id,
    ts = new Date(),
    equity,
    cash_available,
    unrealized_pnl,
    realized_pnl,
    sharpe,
    win_rate,
  } = entry;

  const targetModelId = modelId ?? model_id;
  if (!targetModelId) {
    throw new Error("appendAccountTimeseries requires modelId.");
  }

  await pool.query(
    `
    INSERT INTO agent_account_timeseries (
      model_id,
      ts,
      equity,
      cash_available,
      unrealized_pnl,
      realized_pnl,
      sharpe,
      win_rate
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
    [
      targetModelId,
      new Date(ts),
      toNumber(equity ?? 0),
      cash_available != null ? toNumber(cash_available) : null,
      unrealized_pnl != null ? toNumber(unrealized_pnl) : null,
      realized_pnl != null ? toNumber(realized_pnl) : null,
      sharpe != null ? toNumber(sharpe) : null,
      win_rate != null ? toNumber(win_rate) : null,
    ]
  );
}


export async function insertTrade(trade) {
  const pool = getPool();
  const modelId = trade.model_id ?? trade.modelId;
  if (!modelId) {
    throw new Error("insertTrade requires modelId.");
  }
  if (!trade.symbol) {
    throw new Error("insertTrade requires symbol.");
  }
  if (!trade.side) {
    throw new Error("insertTrade requires side.");
  }

  const quantity = toNumber(trade.quantity ?? trade.size ?? 0);
  const entryPrice =
    trade.entry_price != null ? toNumber(trade.entry_price) : null;
  const exitPrice =
    trade.exit_price != null ? toNumber(trade.exit_price) : null;
  const executedPrice =
    trade.price != null
      ? toNumber(trade.price)
      : exitPrice != null
      ? exitPrice
      : entryPrice;

  const notional =
    trade.notional != null
      ? Math.abs(toNumber(trade.notional))
      : executedPrice != null
      ? Math.abs(executedPrice * quantity)
      : null;
  const notionalUsd =
    trade.notional_usd != null ? Math.abs(toNumber(trade.notional_usd)) : notional;

  const entryTime = trade.entry_time ? new Date(trade.entry_time) : new Date();
  const exitTime = trade.exit_time ? new Date(trade.exit_time) : null;
  const createdAt = trade.created_at ? new Date(trade.created_at) : entryTime;
  const decisionSource = trade.decision_source ?? trade.source ?? "ai_auto";
  const rawExitPlan = trade.exit_plan ?? trade.plan ?? {};
  const takeProfitValue =
    trade.take_profit ?? trade.profit_target ?? rawExitPlan.profit_target ?? null;
  const stopLossValue =
    trade.stop_loss ?? rawExitPlan.stop_loss ?? null;
  const takeProfit = takeProfitValue != null ? toNumber(takeProfitValue) : null;
  const stopLoss = stopLossValue != null ? toNumber(stopLossValue) : null;

  await pool.query(
    `
    INSERT INTO trades (
      model_id,
      symbol,
      side,
      leverage,
      quantity,
      entry_price,
      exit_price,
      price,
      notional,
      notional_usd,
      entry_time,
      exit_time,
      holding_time,
      realized_net_pnl,
      decision_source,
      take_profit,
      stop_loss,
      exit_plan,
      order_id,
      action,
      reason,
      cycle_id,
      created_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
    `,
    [
      modelId,
      trade.symbol,
      trade.side,
      trade.leverage != null ? Number(trade.leverage) : null,
      quantity,
      entryPrice,
      exitPrice,
      executedPrice,
      notional,
      notionalUsd,
      entryTime,
      exitTime,
      trade.holding_time ?? null,
      trade.realized_net_pnl != null ? toNumber(trade.realized_net_pnl) : null,
      decisionSource,
      takeProfit,
      stopLoss,
      rawExitPlan,
      trade.order_id ?? trade.orderId ?? null,
      trade.action ?? null,
      trade.reason ?? null,
      trade.cycle_id ?? trade.cycleId ?? null,
      createdAt,
    ]
  );
}

function mapTradeRowToPosition(row, markPrice) {
  const symbol = normalizeSymbol(row.symbol);
  const entryPrice = toNumber(row.entry_price ?? 0);
  const currentPrice = markPrice != null ? toNumber(markPrice) : entryPrice;
  const quantity = toNumber(row.quantity ?? 0);
  const leverage = Number(row.leverage ?? 1);
  const side = String(row.side ?? "LONG").toUpperCase();
  const notionalUsd =
    row.notional_usd != null ? toNumber(row.notional_usd) : entryPrice * quantity;
  const multiplier = side === "SHORT" ? -1 : 1;
  const unrealizedPnl = (currentPrice - entryPrice) * quantity * multiplier * leverage;
  const entryTime = row.entry_time ? safeTimestamp(row.entry_time) : null;
  const holdingSeconds =
    entryTime != null ? Math.floor((Date.now() - entryTime) / 1000) : null;
  logger.info("positions.mapTradeRowToPosition", {
    trade_id: row.id,
    model_id: row.model_id,
    symbol,
    entry_price: entryPrice,
    mark_price: currentPrice,
    quantity,
    side,
    leverage,
    notional_usd: notionalUsd,
    unrealized_pnl: unrealizedPnl,
  });

  return {
    id: row.id,
    model_id: row.model_id,
    symbol,
    side,
    leverage,
    quantity,
    entry_price: entryPrice,
    current_price: currentPrice,
    notional_usd: notionalUsd,
    unrealized_pnl: unrealizedPnl,
    take_profit: row.take_profit != null ? toNumber(row.take_profit) : null,
    stop_loss: row.stop_loss != null ? toNumber(row.stop_loss) : null,
    exit_plan: row.exit_plan ?? {},
    holding_seconds: holdingSeconds,
    entry_time: entryTime,
    updated_at: safeTimestamp(row.created_at),
    decision_source: row.decision_source ?? null,
    risk_usd: row.exit_plan?.risk_usd ?? null,
  };
}

export async function closeOpenTrades(modelId, symbol, exitPrice, options = {}) {
  const pool = getPool();
  const { liquidationType, liquidationPrice, adl } = options ?? {};
  const { rows } = await pool.query(
    `
    SELECT id, side, entry_price, quantity, leverage, entry_time, notional_usd
    FROM trades
    WHERE model_id = $1 AND symbol = $2 AND exit_time IS NULL
    ORDER BY entry_time ASC
    `,
    [modelId, symbol]
  );
  if (!rows.length) {
    return { closed: 0, realizedPnl: 0 };
  }

  const now = new Date();
  let realized = 0;
  let releasedMargin = 0;
  let totalFees = 0;
  const takerFeeRate = getFeeRate(symbol, "taker");

  for (const row of rows) {
    const entryPrice = toNumber(row.entry_price ?? exitPrice);
    const qty = toNumber(row.quantity ?? 0);
    const leverage = Number(row.leverage ?? 1);
    const direction = String(row.side ?? "LONG").toUpperCase() === "SHORT" ? -1 : 1;
    const pnl = (exitPrice - entryPrice) * qty * leverage * direction;
    const entryNotional =
      row.notional_usd != null
        ? Math.abs(toNumber(row.notional_usd))
        : Math.abs(entryPrice * qty);
    const exitNotional = Math.abs(exitPrice * qty);
    const baseNotional = entryNotional;
    const margin = leverage > 0 ? baseNotional / leverage : baseNotional;
    const holdingMs = row.entry_time
      ? Math.max(0, now.getTime() - row.entry_time.getTime())
      : 0;
    const entryFee = entryNotional * takerFeeRate;
    const exitFee = exitNotional * takerFeeRate;
    const netPnl = pnl - entryFee - exitFee;
    realized += netPnl;
    releasedMargin += margin;
    totalFees += exitFee;

    await pool.query(
      `
      UPDATE trades
      SET exit_price = $1,
          exit_time = $2,
          holding_time = $3,
          realized_net_pnl = $4,
          realized_pnl_price = $4,
          realized_pnl_fee = $5,
          realized_pnl_funding = $6,
          liquidation_type = $7,
          liquidation_price = $8,
          adl = $9
      WHERE id = $10
      `,
      [
        exitPrice,
        now,
        Math.floor(holdingMs / 1000),
        netPnl,
        0,
        0,
        liquidationType ?? null,
        liquidationType ? liquidationPrice ?? exitPrice : null,
        liquidationType ? Boolean(adl) : false,
        row.id,
      ]
    );
  }

  return {
    closed: rows.length,
    realizedPnl: realized,
    releasedMargin,
    feesPaid: totalFees,
  };
}

async function enforceExitTargets(modelId, positions) {
  let realizedDelta = 0;
  let totalFees = 0;
  let triggered = [];
  const closedSymbols = new Set();

  for (const position of positions) {
    if (!position || closedSymbols.has(position.symbol)) continue;
    const currentPrice = Number(position.current_price ?? position.entry_price);
    if (!Number.isFinite(currentPrice)) continue;

    const side = String(position.side ?? "LONG").toUpperCase();
    const takeProfit =
      position.take_profit ??
      position.exit_plan?.profit_target ??
      null;
    const stopLoss =
      position.stop_loss ??
      position.exit_plan?.stop_loss ??
      null;

    let reason = null;
    if (side === "LONG") {
      if (takeProfit != null && currentPrice >= Number(takeProfit)) {
        reason = "take_profit";
      } else if (stopLoss != null && currentPrice <= Number(stopLoss)) {
        reason = "stop_loss";
      }
    } else {
      if (takeProfit != null && currentPrice <= Number(takeProfit)) {
        reason = "take_profit";
      } else if (stopLoss != null && currentPrice >= Number(stopLoss)) {
        reason = "stop_loss";
      }
    }

    if (!reason) continue;

    const closeResult = await closeOpenTrades(
      modelId,
      position.symbol,
      currentPrice
    );
    if (closeResult.closed > 0) {
      realizedDelta += closeResult.realizedPnl ?? 0;
      if (closeResult.feesPaid) {
        totalFees += closeResult.feesPaid;
      }
      triggered.push({
        symbol: position.symbol,
        reason,
        price: currentPrice,
        closed: closeResult.closed,
      });
      closedSymbols.add(position.symbol);
    }
  }

  return { realizedDelta, triggered, feesPaid: totalFees };
}

async function getOpenPositionsGrouped(modelIds) {
  if (!modelIds.length) return new Map();
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT
      id,
      model_id,
      symbol,
      side,
      leverage,
      quantity,
      entry_price,
      notional_usd,
      take_profit,
      stop_loss,
      exit_plan,
      decision_source,
      entry_time,
      created_at
    FROM trades
    WHERE model_id = ANY($1::text[])
      AND exit_time IS NULL
    ORDER BY model_id, entry_time
    `,
    [modelIds]
  );

  if (!rows.length) {
    return new Map(modelIds.map((id) => [id, []]));
  }

  const snapshot = await getMarketSnapshot();
  const grouped = new Map();

  for (const row of rows) {
    const markPrice = await getMarkPrice(row.symbol);
    const position = mapTradeRowToPosition(row, markPrice);
    if (!grouped.has(row.model_id)) {
      grouped.set(row.model_id, []);
    }
    grouped.get(row.model_id).push(position);
  }

  modelIds.forEach((id) => {
    if (!grouped.has(id)) {
      grouped.set(id, []);
    }
  });

  return grouped;
}

export async function getOpenPositions(modelId) {
  const grouped = await getOpenPositionsGrouped([modelId]);
  return grouped.get(modelId) ?? [];
}

export async function insertAgentLog(modelId, publicMessage, cotTraceSummary, options = {}) {
  const pool = getPool();
  const {
    prompt_text,
    response_text,
    response_json,
    created_at = new Date(),
    cycle_id,
    cycleId,
    account_value_snapshot,
    sharpe_snapshot,
    decision_blob,
    review_status = "logged",
    review_notes = null,
    reviewed_at = null,
    reasoning_content = null,
  } = options;
  const createdAt = created_at ? new Date(created_at) : new Date();
  const sanitizedResponse =
    response_json != null ? sanitizeJsonValue(response_json) : null;
  const sanitizedBlob =
    decision_blob != null ? sanitizeJsonValue(decision_blob) : null;
  const responseJsonParam =
    sanitizedResponse != null ? JSON.stringify(sanitizedResponse) : null;
  const decisionBlobParam =
    sanitizedBlob != null ? JSON.stringify(sanitizedBlob) : null;
  const reasoningContent = reasoning_content ?? null;

  await pool.query(
    `
    INSERT INTO agent_logs (
      model_id,
      public_message,
      cot_trace_summary,
      prompt_text,
      response_text,
      response_json,
      cycle_id,
      account_value_snapshot,
      sharpe_snapshot,
      decision_blob,
      reasoning_content,
      review_status,
      review_notes,
      reviewed_at,
      created_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    `,
    [
      modelId,
      publicMessage,
      cotTraceSummary,
      prompt_text ?? null,
      response_text ?? null,
      responseJsonParam ?? null,
      cycle_id ?? cycleId ?? null,
      account_value_snapshot != null ? toNumber(account_value_snapshot) : null,
      sharpe_snapshot != null ? toNumber(sharpe_snapshot) : null,
      decisionBlobParam ?? null,
      reasoningContent ?? null,
      review_status ?? "logged",
      review_notes ?? null,
      reviewed_at ?? null,
      createdAt,
    ]
  );
}

export async function getPriceMap(symbols) {
  if (!symbols.length) return {};
  const pool = getPool();
  const normalizedSymbols = symbols.map((symbol) => normalizeSymbol(symbol));
  const redisRows = await fetchRedisTickers(normalizedSymbols);
  const prices = {};
  const missing = [];

  redisRows.forEach((payload, idx) => {
    const symbol = normalizedSymbols[idx];
    const ticker = hydrateTickerFromRedis(payload, symbol);
    if (ticker) {
      prices[symbol] = ticker;
    } else {
      missing.push(symbol);
    }
  });

  if (missing.length) {
    const storageSymbols = missing.map((symbol) => ensureMarketSymbol(symbol));
    const dbRows = await fetchDbTickers(pool, storageSymbols);
    dbRows.forEach((row) => {
      const base = normalizeSymbol(row.symbol);
      prices[base] = hydrateTickerFromDb(row);
    });
  }

  return prices;
}

export async function getProposalAssets() {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT symbol, side, leverage, notional, stop_loss, notes
    FROM proposal_assets
    ORDER BY symbol
    `
  );

  const snapshot = await getMarketSnapshot();

  return rows.map((row) => {
    const key = normalizeSymbol(row.symbol);
    const tickerInfo = snapshot.prices[key];
    return {
      symbol: row.symbol,
      lastPrice: tickerInfo?.price ?? null,
      side: row.side,
      leverage: Number(row.leverage ?? 0),
      notional: toNumber(row.notional ?? 0),
      stopLoss: toNumber(row.stop_loss ?? 0),
      notes: row.notes ?? "",
    };
  });
}

export async function saveProposalRequest(payload) {
  const pool = getPool();
  const proposals = payload.proposals ?? [];

  if (!proposals.length) {
    return { inserted: 0 };
  }

  const placeholders = proposals
    .map((_, idx) => {
      const base = idx * 6;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    })
    .join(", ");

  const flatParams = proposals.flatMap((item) => [
    item.symbol,
    item.side,
    item.leverage,
    item.notional,
    item.stopLoss,
    item.notes ?? "",
  ]);

  await pool.query(
    `
    INSERT INTO proposal_requests(symbol, side, leverage, notional, stop_loss, notes)
    VALUES ${placeholders}
    `,
    flatParams
  );

  return { inserted: proposals.length };
}

export async function getExperimentReadme() {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT title, description_markdown, rules_json, mode_label
    FROM experiment_readme
    ORDER BY version DESC
    LIMIT 1
    `
  );
  if (!rows.length) return null;
  return {
    title: rows[0].title,
    description_markdown: rows[0].description_markdown,
    rules: rows[0].rules_json,
    mode_label: rows[0].mode_label,
  };
}

export async function getModeState() {
  const readme = await getExperimentReadme();
  return {
    mode: "live",
    replay: null,
    active_experiment: readme
      ? {
          id: "current",
          title: readme.title,
          mode_label: readme.mode_label ?? "LIVE",
        }
      : null,
  };
}

export { normalizeSymbol, DEFAULT_SYMBOLS, NORMALIZED_SYMBOLS };

export async function countAgentLogs(modelId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT COUNT(*)::int AS count
    FROM agent_logs
    WHERE model_id = $1
    `,
    [modelId]
  );
  return rows[0]?.count ?? 0;
}

/**
 * �?Binance API 更新市场价格
 * @returns {Promise<number>} 更新的交易对数量
 */
export async function updateMarketPricesFromBinance() {
  const symbols = ['BTC', 'ETH', 'SOL', 'BNB', 'DOGE', 'XRP'];
  const binanceSymbols = symbols.map(s => s + 'USDT');
  const pool = getPool();
  
  try {
    // 动态导�?node-fetch（避�?ESM 问题�?
    const fetch = (await import('node-fetch')).default;
    
    // 批量获取所有交易对的行�?
    const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }
    
    const allTickers = await response.json();
    const tickerMap = {};
    
    // 构建映射表（从 BTCUSDT -> BTC）
    allTickers.forEach(ticker => {
      if (binanceSymbols.includes(ticker.symbol)) {
        const cleanSymbol = ticker.symbol.replace('USDT', '');
        tickerMap[cleanSymbol] = ticker;
      }
    });
    
    // 更新数据库
    let updated = 0;
    for (const symbol of symbols) {
      const ticker = tickerMap[symbol];
      if (!ticker) continue;
      const storageSymbol = ensureMarketSymbol(symbol);
      
      await pool.query(
        `
        INSERT INTO market_prices (
          symbol, price, change_percent, high_price, low_price, volume, last_update_ts
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (symbol) DO UPDATE SET
          price = EXCLUDED.price,
          change_percent = EXCLUDED.change_percent,
          high_price = EXCLUDED.high_price,
          low_price = EXCLUDED.low_price,
          volume = EXCLUDED.volume,
          last_update_ts = EXCLUDED.last_update_ts,
          updated_at = now()
        `,
        [
          storageSymbol,
          parseFloat(ticker.lastPrice),
          parseFloat(ticker.priceChangePercent),
          parseFloat(ticker.highPrice),
          parseFloat(ticker.lowPrice),
          parseFloat(ticker.volume),
          ticker.closeTime ? new Date(ticker.closeTime) : new Date()
        ]
      );
      
      updated++;
    }
    
    logger.info(
      "dataRepository",
      `[updateMarketPricesFromBinance] Updated ${updated} symbols`
    );
    return updated;
  } catch (error) {
    console.error('Market price update failed:', error.message);
    // 不抛出错误，让系统继续运�?
    return 0;
  }
}

/**
 * 初始�?BTC 基准线模�?
 * @returns {Promise<Object>} 创建的模型和持仓
 */



export async function initializeBtcBenchmark() {
  const pool = getPool();
  const modelId = BASELINE_MODEL_ID;
  const initialUsd = 10000;

  const existing = await getAgentModelById(modelId, { includeSecrets: false });
  if (existing) {
    return { model: existing, message: "BTC benchmark already exists" };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const fetchPrice = async () => {
      const candidates = ["BTC", "BTCUSDT"]; // 支持两种存储格式
      for (const symbol of candidates) {
        const { rows } = await client.query(
          `SELECT price FROM market_prices WHERE symbol = $1 ORDER BY last_update_ts DESC LIMIT 1`,
          [symbol]
        );
        if (rows[0]?.price != null) {
          return Number(rows[0].price);
        }
      }
      return null;
    };

    let btcPrice = await fetchPrice();
    if (!btcPrice) {
      await updateMarketPricesFromBinance();
      btcPrice = await fetchPrice();
    }

    if (!btcPrice) {
      throw new Error("无法获取 BTC 最新价格，请先同步行情。");
    }

    const btcQuantity = initialUsd / btcPrice;

    const template = await getDefaultPromptTemplate();
    if (!template) {
      throw new Error("尚未配置默认提示词模板，无法创建基准模型。");
    }

    await client.query(
      `
      INSERT INTO agent_models (
        model_id,
        display_name,
        api_base_url,
        api_key,
        human_review_required,
        prompt_template_id,
        auto_run_enabled,
        auto_run_interval_minutes,
        display_icon
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (model_id) DO NOTHING
      `,
      [
        modelId,
        "BTC Benchmark",
        null,
        null,
        false,
        template.id,
        false,
        60,
        "icon:gpt",
      ]
    );

    await client.query(
      `
      INSERT INTO agent_accounts_runtime (
        model_id,
        starting_equity,
        latest_equity,
        available_cash,
        total_unrealized_pnl,
        metadata,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6, now())
      ON CONFLICT (model_id) DO UPDATE SET
        starting_equity = EXCLUDED.starting_equity,
        latest_equity = EXCLUDED.latest_equity,
        available_cash = EXCLUDED.available_cash,
        total_unrealized_pnl = EXCLUDED.total_unrealized_pnl,
        metadata = EXCLUDED.metadata,
        updated_at = now()
      `,
      [
        modelId,
        initialUsd,
        initialUsd,
        0,
        0,
        JSON.stringify({
          benchmark_quantity: btcQuantity,
          benchmark_entry_price: btcPrice,
        }),
      ]
    );

    await client.query(
      `
      INSERT INTO agent_account_timeseries (
        model_id,
        ts,
        equity,
        cash_available,
        unrealized_pnl,
        realized_pnl
      )
      VALUES ($1, now(), $2, $3, $4, $5)
      `,
      [modelId, initialUsd, 0, 0, 0]
    );

    await client.query("COMMIT");

    const model = await getAgentModelById(modelId, { includeSecrets: false });
    return {
      model,
      benchmark: {
        initialUsd,
        btcPrice,
        btcQuantity,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("BTC benchmark initialization failed:", error);
    throw error;
  } finally {
    client.release();
  }
}
