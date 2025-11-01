// 集中管理静态 Mock 数据，保证前端展示稳定、可替换。

const BASE_TS = 1730380800000; // 2024-10-31 00:00:00 UTC
const HOUR = 60 * 60 * 1000;

const timeline = Array.from({ length: 72 }, (_, idx) => BASE_TS - (71 - idx) * HOUR);

const MODELS = [
  { id: "gpt-5", name: "GPT 5", color: "#0ea5e9" },
  { id: "claude-sonnet-4-5", name: "CLAUDE SONNET 4.5", color: "#f97316" },
  { id: "gemini-2-5-pro", name: "GEMINI 2.5 PRO", color: "#2563eb" },
  { id: "grok-4", name: "GROK 4", color: "#111827" },
  { id: "deepseek-chat-v3-1", name: "DEEPSEEK CHAT v3.1", color: "#4338ca" },
  { id: "qwen3-max", name: "QWEN3 MAX", color: "#7c3aed" },
];

const BASELINE = { id: "btc-buy-hold", name: "BTC BUY&HOLD", color: "#0f172a" };

function buildSeries(model, base, drift, amplitude) {
  let equity = base;
  const points = timeline.map((timestamp, index) => {
    const oscillation = Math.sin(index / 6 + 0.4) * amplitude;
    equity = Math.max(base * 0.4, equity + drift + oscillation);
    const pct = equity / base - 1;
    return {
      timestamp,
      dollar_equity: Number(equity.toFixed(2)),
      cum_pnl_pct: Number(pct.toFixed(4)),
    };
  });
  return {
    model_id: model.id,
    name: model.name,
    line_key: model.id.replace(/[^a-z0-9]/gi, "_"),
    color: model.color,
    points,
  };
}

const performanceSeries = [
  buildSeries(MODELS[0], 10000, 22, 120),
  buildSeries(MODELS[1], 10000, 18, 90),
  buildSeries(MODELS[2], 10000, 14, 70),
  buildSeries(MODELS[3], 10000, 8, 55),
  buildSeries(MODELS[4], 10000, 26, 130),
  buildSeries(MODELS[5], 10000, 20, 100),
  buildSeries(BASELINE, 10000, 6, 40),
];

const latestSnapshot = performanceSeries.map((series) => ({
  model_id: series.model_id,
  equity: series.points.at(-1)?.dollar_equity ?? 0,
}));

const highest = latestSnapshot.reduce((acc, cur) => (cur.equity > acc.equity ? cur : acc), latestSnapshot[0]);
const lowest = latestSnapshot.reduce((acc, cur) => (cur.equity < acc.equity ? cur : acc), latestSnapshot[0]);

export const performanceTimeseries = {
  serverTime: BASE_TS,
  highest: { model_id: highest.model_id },
  lowest: { model_id: lowest.model_id },
  series: performanceSeries,
};

export const sinceInception = {
  serverTime: BASE_TS,
  sinceInceptionValues: performanceSeries.map((series) => ({
    id: `${series.model_id}-inception`,
    model_id: series.model_id,
    nav_since_inception: 10000,
    inception_date: timeline[0],
    num_invocations: 0,
  })),
};

export const chartSeries = performanceSeries.map((series) => ({
  model_id: series.model_id,
  name: series.name,
  color: series.color,
}));

export const chartPoints = timeline.map((timestamp, index) => ({
  timestamp,
  values: Object.fromEntries(
    performanceSeries.map((series) => [
      series.model_id,
      series.points[index] ? series.points[index].dollar_equity : null,
    ])
  ),
}));

const COINS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"];
const COIN_PRICE = {
  BTC: 109820.85,
  ETH: 3820.64,
  SOL: 182.3,
  BNB: 590.5,
  DOGE: 0.183,
  XRP: 2.48,
};

export const marketPrices = {
  mode: "live",
  replayTimestamp: null,
  serverTime: BASE_TS,
  order: COINS,
  prices: Object.fromEntries(
    COINS.map((symbol) => [
      symbol,
      {
        symbol,
        price: COIN_PRICE[symbol],
        timestamp: BASE_TS,
      },
    ])
  ),
};

export const tickers = COINS.map((symbol) => ({
  symbol,
  price: COIN_PRICE[symbol],
  change: Number((Math.sin(symbol.length) * 2.5).toFixed(2)),
}));

export const modeState = {
  mode: "live",
  replay: null,
};

export const models = [...MODELS, BASELINE].map((meta) => ({
  model_id: meta.id,
  display_name: meta.name,
  description: "示例模型条目，接入真实后端时可替换为策略说明。",
  capabilities: ["趋势跟踪", "风控管理", "仓位调度"],
}));

export const leaderboard = MODELS.map((meta, index) => ({
  model: meta.name,
  pnl: [18.3, 15.4, 12.7, 9.1, 25.4, 21.3][index],
  sharpe: [1.25, 1.11, 0.98, 0.84, 1.36, 1.28][index],
  win: [63, 61, 58, 55, 69, 66][index],
  trades: [128, 112, 97, 88, 156, 141][index],
}));

export const experimentReadme = {
  title: "Alpha Arena - 样例实验协议",
  description_markdown: [
    "此页面用于演示 Alpha Arena 前端界面。",
    "正式接入后请在后端返回实验规则、资金上限、风险参数等 Markdown。",
  ].join("\n\n"),
  rules: {
    starting_capital_usd: 10000,
    market_type: "crypto_perpetuals",
    objective: "风险收益兼顾",
    transparency: "所有模型决策和成交公开展示",
    autonomy: "AI 提案可由人工确认或驳回",
    duration: {
      start_ts: timeline[0],
      end_ts: timeline.at(-1),
    },
  },
};

export const agentsLogs = {
  logs: MODELS.map((meta, index) => ({
    model_id: meta.id,
    timestamp: BASE_TS - (index + 1) * 10 * 60 * 1000,
    public_message: `${meta.name} 当前保持策略，关注核心风险指标，这里为演示文案。`,
    positions_summary: [
      {
        symbol: ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"][index % COINS.length],
        side: index % 2 === 0 ? "LONG" : "SHORT",
        leverage: [8, 6, 5, 4, 3, 7][index],
        thesis: "示例策略说明，可替换为真实模型解释。",
        target: `${(COIN_PRICE[COINS[index % COINS.length]] * 1.08).toFixed(2)}`,
        invalidation: "若关键支撑/阻力被突破则撤退。",
      },
    ],
    risk_notes: "演示用风险说明。",
  })),
};

export const positionsCurrent = {
  serverTime: BASE_TS,
  accountTotals: MODELS.map((meta, index) => ({
    model_id: meta.id,
    timestamp: BASE_TS,
    dollar_equity: [12680.81, 11896.39, 11388.74, 10644.61, 14762.48, 13131.29][index],
    realized_pnl: [1680.81, 989.24, 738.33, 244.61, 2762.48, 2131.29][index],
    total_unrealized_pnl: [420.12, 332.45, 286.13, 190.45, 512.76, 438.63][index],
    cum_pnl_pct: Number(([12680.81, 11896.39, 11388.74, 10644.61, 14762.48, 13131.29][index] / 10000 - 1).toFixed(4)),
    sharpe_ratio: [1.24, 1.12, 1.03, 0.87, 1.36, 1.28][index],
    available_cash: [3200, 3100, 2950, 2800, 3600, 3400][index],
    positions: {
      [COINS[index % COINS.length]]: {
        symbol: COINS[index % COINS.length],
        side: index % 2 === 0 ? "LONG" : "SHORT",
        leverage: [8, 6, 5, 4, 3, 7][index],
        quantity: [0.85, 6.2, 110, 45, 18000, 3400][index],
        notional_usd: Number((COIN_PRICE[COINS[index % COINS.length]] * [0.85, 6.2, 110, 45, 18000, 3400][index]).toFixed(2)),
        entry_price: Number((COIN_PRICE[COINS[index % COINS.length]] * 0.97).toFixed(2)),
        current_price: COIN_PRICE[COINS[index % COINS.length]],
        unrealized_pnl: [320.5, 210.3, 189.2, 112.6, 480.9, 398.7][index],
        exit_plan: {
          profit_target: Number((COIN_PRICE[COINS[index % COINS.length]] * 1.08).toFixed(2)),
          stop_loss: Number((COIN_PRICE[COINS[index % COINS.length]] * 0.92).toFixed(2)),
          invalidation_condition: "若关键趋势破位或波动率飙升。",
        },
      },
    },
  })),
};

export const tradesRecent = {
  trades: [
    {
      model_id: "gpt-5",
      symbol: "BTC",
      side: "LONG",
      leverage: 6,
      quantity: 0.8,
      entry_price: 107200,
      exit_price: 109850,
      entry_time: BASE_TS - 12 * HOUR,
      exit_time: BASE_TS - 4 * HOUR,
      entry_human_time: "2024-10-30 12:00",
      exit_human_time: "2024-10-30 20:00",
      holding_time: "8 小时",
      realized_net_pnl: 2120.4,
      decision_source: "ai_auto",
    },
    {
      model_id: "claude-sonnet-4-5",
      symbol: "ETH",
      side: "SHORT",
      leverage: 4,
      quantity: 12,
      entry_price: 3880,
      exit_price: 3810,
      entry_time: BASE_TS - 36 * HOUR,
      exit_time: BASE_TS - 30 * HOUR,
      entry_human_time: "2024-10-29 12:00",
      exit_human_time: "2024-10-29 18:00",
      holding_time: "6 小时",
      realized_net_pnl: 840.12,
      decision_source: "ai_proposed_human_approved",
    },
    {
      model_id: "deepseek-chat-v3-1",
      symbol: "SOL",
      side: "LONG",
      leverage: 5,
      quantity: 120,
      entry_price: 176.5,
      exit_price: 184.1,
      entry_time: BASE_TS - 60 * HOUR,
      exit_time: BASE_TS - 48 * HOUR,
      entry_human_time: "2024-10-28 12:00",
      exit_human_time: "2024-10-29 00:00",
      holding_time: "12 小时",
      realized_net_pnl: 912.8,
      decision_source: "human_manual",
    },
  ],
};

export const tradesHistory = {
  page: 1,
  pageSize: 20,
  total: tradesRecent.trades.length,
  trades: tradesRecent.trades,
};

export const trades = tradesRecent.trades;

export const pendingDecisions = [
  {
    id: "pending-001",
    modelId: "gemini-2-5-pro",
    asset: "ETH",
    side: "LONG",
    target: 4050,
    stopLoss: 3700,
    size: 8,
    leverage: 5,
    timestamp: BASE_TS - 15 * 60 * 1000,
    comment: "计划在宏观数据公布前加仓 ETH，建议确认目标与止损。",
  },
  {
    id: "pending-002",
    modelId: "grok-4",
    asset: "BNB",
    side: "SHORT",
    target: 560,
    stopLoss: 610,
    size: 30,
    leverage: 3,
    timestamp: BASE_TS - 25 * 60 * 1000,
    comment: "对冲多头敞口，等待手动批准。",
  },
];

export const proposalAssets = COINS.map((symbol) => ({
  symbol,
  lastPrice: COIN_PRICE[symbol],
  side: "LONG",
  leverage: 4,
  notional: symbol === "BTC" ? 40000 : 10000,
  stopLoss: Number((COIN_PRICE[symbol] * 0.93).toFixed(symbol === "DOGE" ? 4 : 2)),
  notes: "此处填写申请理由，提交将进入审批流程。",
}));
