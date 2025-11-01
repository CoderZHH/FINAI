import { getPool } from "./db";
import { getRedis } from "./redis";

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

/**
 * Convert symbols like BTCUSDT into BTC for display purposes.
 */
function normalizeSymbol(symbol) {
  return symbol.replace(/USDT$/i, "");
}

/**
 * Convert an agent_accounts row into the shape expected by the UI.
 */
function mapRowToAccount(row) {
  return {
    model_id: row.model_id,
    name: row.name,
    color: row.color,
    latest_equity: Number(row.latest_equity ?? 0),
    pnl_pct: Number(row.pnl_pct ?? 0),
    sharpe_ratio: Number(row.sharpe_ratio ?? 0),
    win_rate: Number(row.win_rate ?? 0),
    total_trades: Number(row.total_trades ?? 0),
    baseline: row.is_baseline ?? false,
  };
}

/**
 * Build the market snapshot. Redis is queried first; missing data falls back to PostgreSQL.
 */
export async function getMarketSnapshot() {
  const pool = getPool();
  const redis = getRedis();

  const redisKeys = DEFAULT_SYMBOLS.map((symbol) => `prices:${symbol}`);
  const cached = redis ? await redis.mget(redisKeys) : [];

  const prices = {};
  const missingSymbols = [];

  cached.forEach((item, index) => {
    const symbol = DEFAULT_SYMBOLS[index];
    if (item) {
      const parsed = JSON.parse(item);
      prices[normalizeSymbol(symbol)] = {
        symbol: normalizeSymbol(symbol),
        price: Number(parsed.price),
        timestamp: parsed.lastUpdateTs ?? Date.now(),
        change: parsed.changePercent != null ? Number(parsed.changePercent) : null,
      };
    } else {
      missingSymbols.push(symbol);
    }
  });

  if (missingSymbols.length) {
    const { rows } = await pool.query(
      "SELECT symbol, price, change_percent, last_update_ts FROM market_prices WHERE symbol = ANY($1)",
      [missingSymbols]
    );
    rows.forEach((row) => {
      prices[normalizeSymbol(row.symbol)] = {
        symbol: normalizeSymbol(row.symbol),
        price: Number(row.price),
        timestamp: row.last_update_ts ? row.last_update_ts.getTime() : Date.now(),
        change: row.change_percent != null ? Number(row.change_percent) : null,
      };
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

/**
 * Provide a compact price list for the ticker bar.
 */
export async function getTickerRows() {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT symbol, price, change_percent FROM market_prices ORDER BY symbol"
  );
  return rows.map((row) => ({
    symbol: normalizeSymbol(row.symbol),
    price: Number(row.price),
    change: row.change_percent != null ? Number(row.change_percent) : null,
  }));
}

/**
 * Read core metrics for each model account.
 */
export async function getAgentAccounts() {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT model_id, name, color, latest_equity, pnl_pct, sharpe_ratio, win_rate, total_trades, sort_order, is_baseline FROM agent_accounts ORDER BY sort_order"
  );
  return rows.map(mapRowToAccount);
}

/**
 * Return since-inception data used by charts and leaderboards.
 */
export async function getSinceInceptionValues() {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT model_id, nav_since_inception, inception_date, num_invocations FROM agent_since_inception ORDER BY sort_order"
  );

  return rows.map((row) => ({
    id: `${row.model_id}-inception`,
    model_id: row.model_id,
    nav_since_inception: Number(row.nav_since_inception ?? 10000),
    inception_date: row.inception_date ? row.inception_date.getTime() : null,
    num_invocations: Number(row.num_invocations ?? 0),
  }));
}

/**
 * Load the equity history for each model for the main chart panel.
 */
export async function getPerformanceTimeseries() {
  const pool = getPool();
  const accounts = await getAgentAccounts();
  const { rows } = await pool.query(
    "SELECT model_id, timestamp, dollar_equity, cum_pnl_pct FROM agent_equity_history ORDER BY timestamp"
  );

  const historyByModel = rows.reduce((acc, row) => {
    const key = row.model_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push({
      timestamp: row.timestamp.getTime(),
      dollar_equity: Number(row.dollar_equity ?? 0),
      cum_pnl_pct: Number(row.cum_pnl_pct ?? 0),
    });
    return acc;
  }, {});

  const series = accounts.map((account) => ({
    model_id: account.model_id,
    name: account.name,
    line_key: account.model_id.replace(/[^a-z0-9]/gi, "_"),
    color: account.color,
    points: historyByModel[account.model_id] ?? [],
  }));

  const latestEquities = accounts.map((account) => ({
    model_id: account.model_id,
    equity: account.latest_equity,
  }));

  const highest = latestEquities.reduce(
    (acc, cur) => (cur.equity > acc.equity ? cur : acc),
    latestEquities[0]
  );
  const lowest = latestEquities.reduce(
    (acc, cur) => (cur.equity < acc.equity ? cur : acc),
    latestEquities[0]
  );

  return {
    highest: { model_id: highest?.model_id },
    lowest: { model_id: lowest?.model_id },
    series,
  };
}

/**
 * Aggregate current positions for the Positions tab.
 */
export async function getPositionsSnapshot() {
  const pool = getPool();
  const accounts = await getAgentAccounts();
  const { rows } = await pool.query(
    "SELECT model_id, symbol, side, leverage, quantity, notional, entry_price, mark_price, unrealized_pnl, exit_plan FROM agent_positions ORDER BY model_id, symbol"
  );

  const positionsByModel = rows.reduce((acc, row) => {
    const key = row.model_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push({
      symbol: row.symbol,
      side: row.side,
      leverage: Number(row.leverage ?? 0),
      quantity: Number(row.quantity ?? 0),
      notional_usd: Number(row.notional ?? 0),
      entry_price: Number(row.entry_price ?? 0),
      current_price: Number(row.mark_price ?? 0),
      unrealized_pnl: Number(row.unrealized_pnl ?? 0),
      exit_plan: row.exit_plan ?? {},
    });
    return acc;
  }, {});

  const filteredAccounts = accounts.filter((account) => !account.baseline);

  return filteredAccounts.map((account) => {
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
      available_cash: Math.max(0, account.latest_equity - totalNotional),
      positions: Object.fromEntries(positions.map((pos) => [pos.symbol, pos])),
    };
  });
}

/**
 * Recent model messages for the ModelChat tab.
 */
export async function getAgentLogs(limit = 20) {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT model_id, timestamp, public_message, positions_summary, risk_notes, decision_json FROM agent_logs ORDER BY timestamp DESC LIMIT $1",
    [limit]
  );
  return rows.map((row) => ({
    model_id: row.model_id,
    timestamp: row.timestamp.getTime(),
    public_message: row.public_message,
    positions_summary: row.positions_summary ?? [],
    risk_notes: row.risk_notes,
    decision_json: row.decision_json ?? {},
  }));
}

/**
 * Recent trades for the right-hand feed and tabs.
 */
export async function getRecentTrades(limit = 20) {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT id, model_id, symbol, side, leverage, quantity, entry_price, exit_price,
           entry_time, exit_time, holding_time, realized_net_pnl, decision_source,
           exit_plan
    FROM trades
    ORDER BY exit_time DESC
    LIMIT $1
    `,
    [limit]
  );

  return rows.map((row) => ({
    id: row.id,
    model_id: row.model_id,
    symbol: row.symbol,
    side: row.side,
    leverage: Number(row.leverage ?? 0),
    quantity: Number(row.quantity ?? 0),
    entry_price: Number(row.entry_price ?? 0),
    exit_price: Number(row.exit_price ?? 0),
    entry_time: row.entry_time?.getTime() ?? null,
    exit_time: row.exit_time?.getTime() ?? null,
    entry_human_time: row.entry_time?.toISOString().replace("T", " ").replace("Z", ""),
    exit_human_time: row.exit_time?.toISOString().replace("T", " ").replace("Z", ""),
    holding_time: row.holding_time,
    realized_net_pnl: Number(row.realized_net_pnl ?? 0),
    decision_source: row.decision_source,
    exit_plan: row.exit_plan ?? {},
  }));
}

/**
 * Paginated trade history for the History tab (supports optional time window).
 */
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
      leverage: Number(row.leverage ?? 0),
      quantity: Number(row.quantity ?? 0),
      entry_price: Number(row.entry_price ?? 0),
      exit_price: Number(row.exit_price ?? 0),
      entry_time: row.entry_time?.getTime() ?? null,
      exit_time: row.exit_time?.getTime() ?? null,
      entry_human_time: row.entry_time?.toISOString().replace("T", " ").replace("Z", ""),
      exit_human_time: row.exit_time?.toISOString().replace("T", " ").replace("Z", ""),
      holding_time: row.holding_time,
      realized_net_pnl: Number(row.realized_net_pnl ?? 0),
      decision_source: row.decision_source,
      exit_plan: row.exit_plan ?? {},
    })),
    page,
    pageSize,
    total: Number(totalRes.rows[0]?.count ?? 0),
  };
}

/**
 * Load pending AI decisions for the "Decision" tab.
 */
export async function getPendingDecisions() {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT id, model_id, asset, side, target, stop_loss, size, leverage, comment, timestamp
    FROM pending_decisions
    WHERE status = 'pending'
    ORDER BY timestamp DESC
    `
  );

  return rows.map((row) => ({
    id: row.id,
    modelId: row.model_id,
    asset: row.asset,
    side: row.side,
    target: Number(row.target ?? 0),
    stopLoss: Number(row.stop_loss ?? 0),
    size: Number(row.size ?? 0),
    leverage: Number(row.leverage ?? 0),
    timestamp: row.timestamp?.getTime() ?? Date.now(),
    comment: row.comment,
  }));
}

/**
 * Update a pending decision and mark it as confirmed.
 */
export async function confirmDecision(decision) {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    UPDATE pending_decisions
    SET side = $2,
        target = $3,
        stop_loss = $4,
        size = $5,
        leverage = $6,
        comment = $7,
        status = 'confirmed',
        confirmed_at = now()
    WHERE id = $1
    RETURNING *
    `,
    [
      decision.id,
      decision.side,
      decision.target,
      decision.stopLoss,
      decision.size,
      decision.leverage,
      decision.comment,
    ]
  );
  return rows[0] ?? null;
}

/**
 * Return proposal defaults for each asset in the "Submit Trade" tab.
 */
export async function getProposalAssets() {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT symbol, side, leverage, notional, stop_loss, notes
    FROM proposal_assets
    ORDER BY sort_order
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
      notional: Number(row.notional ?? 0),
      stopLoss: Number(row.stop_loss ?? 0),
      notes: row.notes ?? "",
    };
  });
}

/**
 * Persist a batch of proposal requests.
 */
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

/**
 * Fetch README/experiment mode metadata.
 */
export async function getExperimentReadme() {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT title, description_markdown, rules_json, mode_label FROM experiment_readme ORDER BY version DESC LIMIT 1"
  );
  if (!rows.length) return null;
  return {
    title: rows[0].title,
    description_markdown: rows[0].description_markdown,
    rules: rows[0].rules_json,
    mode_label: rows[0].mode_label,
  };
}

/**
 * Summarise the current experiment mode for the header badge.
 */
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