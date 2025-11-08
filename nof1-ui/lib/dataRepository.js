import { getPool } from "./db.js";
import { getRedis } from "./redis.js";

/**
 * Trading pairs tracked by the system. BINANCE_SYMBOLS env var can override the list.
 */
const DEFAULT_SYMBOLS = (() => {
  try {
    return JSON.parse(
      process.env.BINANCE_SYMBOLS ||
        '["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","DOGEUSDT","XRPUSDT"]'
    );
  } catch (err) {
    console.warn("BINANCE_SYMBOLS parse failed, using default symbols.", err);
    return ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "DOGEUSDT", "XRPUSDT"];
  }
})();

const NORMALIZED_SYMBOLS = DEFAULT_SYMBOLS.map(normalizeSymbol);

function normalizeSymbol(symbol) {
  if (!symbol) return symbol;
  return symbol.replace(/USDT$/i, "");
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

async function fetchRedisTickers(symbols) {
  const redis = getRedis();
  if (!redis) {
    return new Array(symbols.length).fill(null);
  }

  const redisKeys = symbols.map((symbol) => `prices:${symbol}`);
  return redis.mget(redisKeys);
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
  return {
    model_id: row.model_id,
    display_name: row.display_name ?? row.model_id,
    api_base_url: row.api_base_url ?? "",
    api_key: includeSecrets ? apiKey : "",
    has_api_key: Boolean(apiKey),
    system_prompt: row.system_prompt ?? "",
    user_prompt: row.user_prompt ?? "",
    human_review_required: Boolean(row.human_review_required ?? false),
    created_at: row.created_at ? safeTimestamp(row.created_at) : null,
    updated_at: row.updated_at ? safeTimestamp(row.updated_at) : null,
  };
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
    system_prompt: row.system_prompt ?? "",
    user_prompt: row.user_prompt ?? "",
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
      symbol,
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
      volume_avg = EXCLUDED.volume_avg,
      ema20 = EXCLUDED.ema20,
      ema50 = EXCLUDED.ema50,
      macd = EXCLUDED.macd,
      rsi_7 = EXCLUDED.rsi_7,
      rsi_14 = EXCLUDED.rsi_14,
      open_interest = EXCLUDED.open_interest,
      open_interest_avg = EXCLUDED.open_interest_avg,
      funding_rate = EXCLUDED.funding_rate,
      atr_3 = EXCLUDED.atr_3,
      atr_14 = EXCLUDED.atr_14,
      ema20_htf = EXCLUDED.ema20_htf,
      ema50_htf = EXCLUDED.ema50_htf,
      macd_htf = EXCLUDED.macd_htf,
      rsi_14_htf = EXCLUDED.rsi_14_htf,
      last_update_ts = EXCLUDED.last_update_ts,
      raw_payload = EXCLUDED.raw_payload,
      updated_at = now()
    `,
    [
      symbol,
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
  const filters = ["symbol = $1", "timeframe = $2"];
  const params = [symbol, timeframe];
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
  const { rows } = await pool.query(
    `
    SELECT
      m.model_id,
      m.display_name,
      m.api_base_url,
      m.api_key,
      m.system_prompt,
      m.user_prompt,
      m.human_review_required,
      m.created_at,
      m.updated_at
    FROM agent_models m
    ORDER BY m.display_name, m.model_id
    `
  );

  return rows.map((row) => mapModelRow(row, { includeSecrets }));
}

export async function getAgentModelById(modelId, { includeSecrets = true } = {}) {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT
      model_id,
      display_name,
      api_base_url,
      api_key,
      human_review_required,
      system_prompt,
      user_prompt,
      created_at,
      updated_at
    FROM agent_models
    WHERE model_id = $1
    `,
    [modelId]
  );
  if (!rows.length) return null;
  return mapModelRow(rows[0], { includeSecrets });
}

export async function createAgentModel(payload) {
  const pool = getPool();

  const {
    model_id,
    display_name,
    api_base_url,
    api_key,
    human_review_required = false,
    system_prompt = "",
    user_prompt = "",
  } = payload;

  const { rows } = await pool.query(
    `
    INSERT INTO agent_models (
      model_id,
      display_name,
      api_base_url,
      api_key,
      human_review_required,
      system_prompt,
      user_prompt
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING *
    `,
    [
      model_id,
      display_name,
      api_base_url ?? null,
      api_key ?? null,
      human_review_required,
      system_prompt ?? "",
      user_prompt ?? "",
    ]
  );

  return mapModelRow(rows[0]);
}

export async function updateAgentModel(modelId, updates) {
  const pool = getPool();
  const allowed = {
    display_name: "display_name",
    api_base_url: "api_base_url",
    api_key: "api_key",
    system_prompt: "system_prompt",
    user_prompt: "user_prompt",
    human_review_required: "human_review_required",
  };

  const fields = [];
  const values = [];
  let idx = 1;

  Object.entries(updates).forEach(([key, value]) => {
    const column = allowed[key];
    if (!column) return;
    let transformed = value;
    fields.push(`${column} = $${idx}`);
    values.push(transformed);
    idx += 1;
  });

  if (!fields.length) {
    console.log("[dataRepository] updateAgentModel no fields changed", {
      modelId,
    });
    return getAgentModelById(modelId);
  }

  fields.push(`updated_at = now()`);

  values.push(modelId);

  console.log("[dataRepository] updateAgentModel query", {
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

  console.log("[dataRepository] updateAgentModel rows", rows);

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

export async function getAgentAccounts() {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT
      m.model_id,
      m.display_name,
      m.system_prompt,
      m.user_prompt,
      m.human_review_required,
      COALESCE(a.starting_equity, 10000) AS starting_equity,
      COALESCE(a.latest_equity, 10000) AS latest_equity,
      COALESCE(a.available_cash, COALESCE(a.latest_equity, 10000)) AS available_cash,
      COALESCE(a.total_unrealized_pnl, 0) AS total_unrealized_pnl,
      COALESCE(a.sharpe_ratio, 0) AS sharpe_ratio,
      COALESCE(a.win_rate, 0) AS win_rate,
      COALESCE(a.trade_count, 0) AS trade_count
    FROM agent_models m
    LEFT JOIN agent_accounts_runtime a ON a.model_id = m.model_id
    ORDER BY m.display_name, m.model_id
    `
  );

  return rows.map(mapAccountRow);
}

export async function getSinceInceptionValues() {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT model_id, nav_since_inception, inception_date, num_invocations
    FROM agent_since_inception
    ORDER BY model_id
    `
  );

  return rows.map((row) => ({
    id: `${row.model_id}-inception`,
    model_id: row.model_id,
    nav_since_inception: toNumber(row.nav_since_inception ?? 10000),
    inception_date: row.inception_date ? row.inception_date.getTime() : null,
    num_invocations: Number(row.num_invocations ?? 0),
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
  const accounts = await getAgentAccounts();
  if (!accounts.length) return [];

  const modelIds = accounts.map((account) => account.model_id);
  const { rows } = await pool.query(
    `
    SELECT
      model_id,
      symbol,
      side,
      leverage,
      entry_price,
      current_price,
      quantity,
      notional,
      notional_usd,
      unrealized_pnl,
      take_profit,
      stop_loss,
      liquidation_price,
      sl_oid,
      tp_oid,
      entry_oid,
      confidence,
      risk_usd,
      wait_for_fill,
      holding_seconds,
      exit_plan,
      updated_at
    FROM agent_positions_runtime
    WHERE model_id = ANY($1::text[])
    ORDER BY model_id, symbol
    `,
    [modelIds]
  );

  const marketSnapshot = await getMarketSnapshot();

  const positionsByModel = rows.reduce((acc, row) => {
    const key = row.model_id;
    if (!acc[key]) acc[key] = [];

    const rawSymbol = row.symbol;
    const normalizedSymbol = normalizeSymbol(rawSymbol);
    const ticker = marketSnapshot.prices[normalizedSymbol];
    const lastPrice = ticker ? toNumber(ticker.price) : toNumber(row.current_price ?? row.entry_price);

    const side = String(row.side || "LONG").toUpperCase();
    const entryPrice = toNumber(row.entry_price ?? lastPrice);
    const quantity = toNumber(row.quantity ?? 0);
    const leverage = Number(row.leverage ?? 1);
    const notionalUsd = toNumber(row.notional ?? entryPrice * quantity * leverage);
    const notionalUsdOverride =
      row.notional_usd != null ? toNumber(row.notional_usd) : notionalUsd;

    const pnl = row.unrealized_pnl != null
      ? toNumber(row.unrealized_pnl)
      : (lastPrice - entryPrice) * quantity * (side === "SHORT" ? -1 : 1) * leverage;

    acc[key].push({
      symbol: normalizedSymbol,
      side,
      leverage,
      quantity,
      notional_usd: notionalUsdOverride,
      entry_price: entryPrice,
      current_price: lastPrice,
      unrealized_pnl: pnl,
      take_profit: row.take_profit != null ? toNumber(row.take_profit) : null,
      stop_loss: row.stop_loss != null ? toNumber(row.stop_loss) : null,
      exit_plan: row.exit_plan ?? {},
      holding_seconds: Number(row.holding_seconds ?? 0),
      updated_at: safeTimestamp(row.updated_at),
      liquidation_price:
        row.liquidation_price != null ? toNumber(row.liquidation_price) : null,
      confidence: row.confidence != null ? toNumber(row.confidence) : null,
      risk_usd: row.risk_usd != null ? toNumber(row.risk_usd) : null,
      wait_for_fill: Boolean(row.wait_for_fill ?? false),
      sl_oid: row.sl_oid != null ? row.sl_oid : null,
      tp_oid: row.tp_oid != null ? row.tp_oid : null,
      entry_oid: row.entry_oid != null ? row.entry_oid : null,
    });
    return acc;
  }, {});

  return accounts.map((account) => {
    const positions = positionsByModel[account.model_id] ?? [];
    const totalUnrealized = positions.reduce((sum, pos) => sum + pos.unrealized_pnl, 0);
    const totalNotional = positions.reduce((sum, pos) => sum + pos.notional_usd, 0);

    return {
      model_id: account.model_id,
      timestamp: Date.now(),
      dollar_equity: account.latest_equity,
      total_unrealized_pnl: totalUnrealized,
      cum_pnl_pct: account.pnl_pct,
      sharpe_ratio: account.sharpe_ratio,
      available_cash: account.available_cash ?? Math.max(0, account.latest_equity - totalNotional),
      positions: Object.fromEntries(positions.map((pos) => [pos.symbol, pos])),
    };
  });
}

export async function getAgentLogs(limit = 20) {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT id, model_id, public_message, cot_trace_summary, prompt_text, response_text, response_json, created_at
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
  }));
}

export async function getRecentTrades(limit = 20) {
  const pool = getPool();
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

export async function getPendingDecisions() {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT
      pd.id,
      pd.model_id,
      m.display_name,
      pd.decision_blob,
      pd.inserted_at,
      pd.status,
      pd.decision_type,
      pd.target_symbol,
      pd.auto_executed
    FROM pending_decisions pd
    LEFT JOIN agent_models m ON m.model_id = pd.model_id
    WHERE status = 'pending'
    ORDER BY inserted_at DESC
    `
  );

  return rows.map((row) => ({
    id: row.id,
      model_id: row.model_id,
      model_name: row.display_name ?? row.model_id,
      decision_blob: row.decision_blob ?? {},
      inserted_at: safeTimestamp(row.inserted_at),
      status: row.status,
      decision_type: row.decision_type ?? null,
      target_symbol: row.target_symbol ?? null,
      auto_executed: Boolean(row.auto_executed ?? false),
    }));
  }

  export async function getPendingDecisionById(decisionId) {
    const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT
      pd.id,
        pd.model_id,
        m.display_name,
        pd.decision_blob,
        pd.inserted_at,
        pd.status,
        pd.decision_type,
        pd.target_symbol,
        pd.auto_executed
      FROM pending_decisions pd
      LEFT JOIN agent_models m ON m.model_id = pd.model_id
      WHERE id = $1
      `,
      [decisionId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    model_id: row.model_id,
    model_name: row.display_name ?? row.model_id,
    decision_blob: row.decision_blob ?? {},
    inserted_at: safeTimestamp(row.inserted_at),
    status: row.status,
    decision_type: row.decision_type ?? null,
    target_symbol: row.target_symbol ?? null,
    auto_executed: Boolean(row.auto_executed ?? false),
  };
}

export async function createPendingDecision(
  modelId,
  decisionBlob,
  status = "pending",
  insertedAt = new Date(),
  options = {}
) {
  const pool = getPool();
  const {
    decision_type = null,
    target_symbol = null,
    auto_executed = false,
  } = options ?? {};
  const { rows } = await pool.query(
    `
    INSERT INTO pending_decisions (
      model_id,
      decision_blob,
      status,
      inserted_at,
      decision_type,
      target_symbol,
      auto_executed
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, model_id, decision_blob, inserted_at, status, decision_type, target_symbol, auto_executed
    `,
    [modelId, decisionBlob, status, insertedAt, decision_type, target_symbol, auto_executed]
  );
  return rows[0];
}

export async function updatePendingDecisionStatus(decisionId, status) {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    UPDATE pending_decisions
    SET status = $2
    WHERE id = $1
    RETURNING id, model_id, decision_blob, inserted_at, status, decision_type, target_symbol, auto_executed
    `,
    [decisionId, status]
  );
  return rows[0] ?? null;
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
      updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
    ON CONFLICT (model_id) DO UPDATE SET
      latest_equity = EXCLUDED.latest_equity,
      available_cash = EXCLUDED.available_cash,
      total_unrealized_pnl = EXCLUDED.total_unrealized_pnl,
      sharpe_ratio = EXCLUDED.sharpe_ratio,
      win_rate = EXCLUDED.win_rate,
      trade_count = EXCLUDED.trade_count,
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

export async function getRuntimePositions(modelId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT
      id,
      model_id,
      symbol,
      side,
      leverage,
      entry_price,
      current_price,
      quantity,
      notional,
      unrealized_pnl,
      take_profit,
      stop_loss,
      holding_seconds,
      exit_plan,
      updated_at
    FROM agent_positions_runtime
    WHERE model_id = $1
    `,
    [modelId]
  );

  return rows.map((row) => ({
    id: row.id,
    model_id: row.model_id,
    symbol: row.symbol,
    side: row.side,
    leverage: Number(row.leverage ?? 0),
    entry_price: toNumber(row.entry_price ?? 0),
    current_price: toNumber(row.current_price ?? 0),
    quantity: toNumber(row.quantity ?? 0),
    notional: toNumber(row.notional ?? 0),
    unrealized_pnl: toNumber(row.unrealized_pnl ?? 0),
    take_profit: row.take_profit != null ? toNumber(row.take_profit) : null,
    stop_loss: row.stop_loss != null ? toNumber(row.stop_loss) : null,
    holding_seconds: Number(row.holding_seconds ?? 0),
    exit_plan: row.exit_plan ?? {},
    updated_at: safeTimestamp(row.updated_at),
  }));
}

export async function upsertRuntimePosition(modelId, payload) {
  const pool = getPool();
  const symbol = payload.symbol;
  if (!symbol) {
    throw new Error("Position symbol is required");
  }

  await pool.query(
    `
    INSERT INTO agent_positions_runtime (
      model_id,
      symbol,
      side,
      leverage,
      entry_price,
      current_price,
      quantity,
      notional,
      unrealized_pnl,
      take_profit,
      stop_loss,
      holding_seconds,
      exit_plan,
      updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
    ON CONFLICT (model_id, symbol) DO UPDATE SET
      side = EXCLUDED.side,
      leverage = EXCLUDED.leverage,
      entry_price = EXCLUDED.entry_price,
      current_price = EXCLUDED.current_price,
      quantity = EXCLUDED.quantity,
      notional = EXCLUDED.notional,
      unrealized_pnl = EXCLUDED.unrealized_pnl,
      take_profit = EXCLUDED.take_profit,
      stop_loss = EXCLUDED.stop_loss,
      holding_seconds = EXCLUDED.holding_seconds,
      exit_plan = EXCLUDED.exit_plan,
      updated_at = EXCLUDED.updated_at
    `,
    [
      modelId,
      symbol,
      payload.side,
      Number(payload.leverage ?? 1),
      toNumber(payload.entry_price ?? 0),
      toNumber(payload.current_price ?? payload.entry_price ?? 0),
      toNumber(payload.quantity ?? 0),
      toNumber(payload.notional ?? 0),
      toNumber(payload.unrealized_pnl ?? 0),
      payload.take_profit != null ? toNumber(payload.take_profit) : null,
      payload.stop_loss != null ? toNumber(payload.stop_loss) : null,
      Number(payload.holding_seconds ?? 0),
      payload.exit_plan ?? {},
    ]
  );
}

export async function deleteRuntimePosition(modelId, symbol) {
  const pool = getPool();
  await pool.query(
    `
    DELETE FROM agent_positions_runtime
    WHERE model_id = $1 AND symbol = $2
    `,
    [modelId, symbol]
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
    trade.notional != null ? toNumber(trade.notional) : executedPrice != null ? executedPrice * quantity : null;
  const notionalUsd =
    trade.notional_usd != null ? toNumber(trade.notional_usd) : notional;

  const entryTime = trade.entry_time ? new Date(trade.entry_time) : new Date();
  const exitTime = trade.exit_time ? new Date(trade.exit_time) : null;
  const createdAt = trade.created_at ? new Date(trade.created_at) : entryTime;
  const decisionSource = trade.decision_source ?? trade.source ?? "ai_auto";

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
      exit_plan,
      order_id,
      action,
      reason,
      cycle_id,
      created_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
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
      trade.exit_plan ?? trade.plan ?? {},
      trade.order_id ?? trade.orderId ?? null,
      trade.action ?? null,
      trade.reason ?? null,
      trade.cycle_id ?? trade.cycleId ?? null,
      createdAt,
    ]
  );
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
  } = options;
  const createdAt = created_at ? new Date(created_at) : new Date();

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
      created_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `,
    [
      modelId,
      publicMessage,
      cotTraceSummary,
      prompt_text ?? null,
      response_text ?? null,
      response_json ?? null,
      cycle_id ?? cycleId ?? null,
      account_value_snapshot != null ? toNumber(account_value_snapshot) : null,
      sharpe_snapshot != null ? toNumber(sharpe_snapshot) : null,
      createdAt,
    ]
  );
}

export async function getPriceMap(symbols) {
  if (!symbols.length) return {};
  const pool = getPool();
  const redisRows = await fetchRedisTickers(symbols);
  const prices = {};
  const missing = [];

  redisRows.forEach((payload, idx) => {
    const symbol = symbols[idx];
    const ticker = hydrateTickerFromRedis(payload, symbol);
    if (ticker) {
      prices[symbol] = ticker;
    } else {
      missing.push(symbol);
    }
  });

  if (missing.length) {
    const dbRows = await fetchDbTickers(pool, missing);
    dbRows.forEach((row) => {
      prices[row.symbol] = hydrateTickerFromDb(row);
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
