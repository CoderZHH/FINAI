// 集中管理静态 Mock 数据，保证前端展示稳定、可替换。
// 本文件用于前端开发阶段模拟后端 API 返回数据，正式上线后可替换为真实接口。

// ============================================================================
// 时间轴配置
// ============================================================================

/** @type {number} 基准时间戳：2024-10-31 00:00:00 UTC */
const BASE_TS = 1730380800000;

/** @type {number} 一小时的毫秒数 */
const HOUR = 60 * 60 * 1000;

/**
 * 生成 72 小时的时间轴数组（3天历史数据）
 * 从基准时间往前推 71 小时，每小时一个数据点
 */
const timeline = Array.from({ length: 72 }, (_, idx) => BASE_TS - (71 - idx) * HOUR);

// ============================================================================
// 模型配置
// ============================================================================

/**
 * AI 模型元数据配置
 * 每个模型包含唯一标识、显示名称和图表颜色
 */
const MODELS = [
  { id: "gpt-5", name: "GPT 5", color: "#0ea5e9" }, // 天蓝色
  { id: "claude-sonnet-4-5", name: "CLAUDE SONNET 4.5", color: "#f97316" }, // 橙色
  { id: "gemini-2-5-pro", name: "GEMINI 2.5 PRO", color: "#2563eb" }, // 蓝色
  { id: "grok-4", name: "GROK 4", color: "#111827" }, // 深灰色
  { id: "deepseek-chat-v3-1", name: "DEEPSEEK CHAT v3.1", color: "#4338ca" }, // 靛蓝色
  { id: "qwen3-max", name: "QWEN3 MAX", color: "#7c3aed" }, // 紫色
];

/**
 * 基准策略（买入持有 BTC）
 * 用于对比 AI 模型的表现
 */
const BASELINE = { id: "btc-buy-hold", name: "BTC BUY&HOLD", color: "#0f172a" };

// ============================================================================
// 数据生成函数
// ============================================================================

/**
 * 生成单个模型的权益曲线数据
 * @param {Object} model - 模型配置对象
 * @param {number} base - 起始资金（美元）
 * @param {number} drift - 每小时增长趋势值
 * @param {number} amplitude - 波动幅度
 * @returns {Object} 包含模型信息和时间序列数据的对象
 */
function buildSeries(model, base, drift, amplitude) {
  let equity = base; // 当前权益值
  const points = timeline.map((timestamp, index) => {
    // 使用正弦函数模拟市场波动
    const oscillation = Math.sin(index / 6 + 0.4) * amplitude;
    // 累加趋势和波动，确保权益不低于初始值的 40%
    equity = Math.max(base * 0.4, equity + drift + oscillation);
    // 计算累计收益率
    const pct = equity / base - 1;
    return {
      timestamp, // 时间戳
      dollar_equity: Number(equity.toFixed(2)), // 当前权益（美元）
      cum_pnl_pct: Number(pct.toFixed(4)), // 累计收益率（百分比）
    };
  });
  return {
    model_id: model.id, // 模型唯一标识
    name: model.name, // 模型显示名称
    line_key: model.id.replace(/[^a-z0-9]/gi, "_"), // 图表用的键名（去除特殊字符）
    color: model.color, // 曲线颜色
    points, // 时间序列数据点
  };
}

// ============================================================================
// 性能数据
// ============================================================================

/**
 * 所有模型的性能时间序列数据
 * 包含 6 个 AI 模型 + 1 个基准策略
 * 参数：(模型, 初始资金, 每小时增长, 波动幅度)
 */
const performanceSeries = [
  buildSeries(MODELS[0], 10000, 22, 120), // GPT 5: 高增长高波动
  buildSeries(MODELS[1], 10000, 18, 90), // Claude: 中高增长中波动
  buildSeries(MODELS[2], 10000, 14, 70), // Gemini: 中等增长
  buildSeries(MODELS[3], 10000, 8, 55), // Grok: 低增长低波动
  buildSeries(MODELS[4], 10000, 26, 130), // Deepseek: 最高增长最高波动
  buildSeries(MODELS[5], 10000, 20, 100), // Qwen3: 高增长
  buildSeries(BASELINE, 10000, 6, 40), // 基准: 低增长低波动
];

/**
 * 计算每个模型的最新权益快照
 * 用于排行榜和统计数据
 */
const latestSnapshot = performanceSeries.map((series) => ({
  model_id: series.model_id,
  equity: series.points.at(-1)?.dollar_equity ?? 0, // 最后一个数据点的权益值
}));

/** 找出表现最好的模型 */
const highest = latestSnapshot.reduce((acc, cur) => (cur.equity > acc.equity ? cur : acc), latestSnapshot[0]);

/** 找出表现最差的模型 */
const lowest = latestSnapshot.reduce((acc, cur) => (cur.equity < acc.equity ? cur : acc), latestSnapshot[0]);

/**
 * 导出：性能时间序列数据（用于主图表）
 */
export const performanceTimeseries = {
  serverTime: BASE_TS, // 服务器时间戳
  highest: { model_id: highest.model_id }, // 最佳模型 ID
  lowest: { model_id: lowest.model_id }, // 最差模型 ID
  series: performanceSeries, // 完整时间序列数据
};

/**
 * 导出：自启动以来的统计数据
 */
export const sinceInception = {
  serverTime: BASE_TS,
  sinceInceptionValues: performanceSeries.map((series) => ({
    id: `${series.model_id}-inception`, // 唯一标识
    model_id: series.model_id,
    nav_since_inception: 10000, // 起始净值
    inception_date: timeline[0], // 启动日期
    num_invocations: 0, // 调用次数（Mock 数据暂为 0）
  })),
};

/**
 * 导出：图表系列配置（用于图例）
 */
export const chartSeries = performanceSeries.map((series) => ({
  model_id: series.model_id,
  name: series.name,
  color: series.color,
}));

/**
 * 导出：图表数据点（用于 Recharts）
 * 将时间序列转换为适合图表库的格式
 */
export const chartPoints = timeline.map((timestamp, index) => ({
  timestamp, // X 轴：时间
  values: Object.fromEntries(
    // Y 轴：每个模型的权益值
    performanceSeries.map((series) => [
      series.model_id,
      series.points[index] ? series.points[index].dollar_equity : null,
    ])
  ),
}));

// ============================================================================
// 市场数据
// ============================================================================

/** 支持的加密货币符号列表 */
const COINS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"];

/**
 * 各币种的当前价格（美元）
 * 用于行情条和交易计算
 */
const COIN_PRICE = {
  BTC: 109820.85,
  ETH: 3820.64,
  SOL: 182.3,
  BNB: 590.5,
  DOGE: 0.183,
  XRP: 2.48,
};

/**
 * 导出：实时市场价格数据
 */
export const marketPrices = {
  mode: "live", // 模式：实盘 (live) 或回放 (replay)
  replayTimestamp: null, // 回放模式的时间戳
  serverTime: BASE_TS, // 服务器时间
  order: COINS, // 币种显示顺序
  prices: Object.fromEntries(
    COINS.map((symbol) => [
      symbol,
      {
        symbol, // 币种符号
        price: COIN_PRICE[symbol], // 当前价格
        timestamp: BASE_TS, // 价格更新时间
      },
    ])
  ),
};

/**
 * 导出：行情条数据（带涨跌幅）
 */
export const tickers = COINS.map((symbol) => ({
  symbol, // 币种符号
  price: COIN_PRICE[symbol], // 当前价格
  change: Number((Math.sin(symbol.length) * 2.5).toFixed(2)), // 模拟涨跌幅（基于符号长度的伪随机数）
}));

/**
 * 导出：系统模式状态
 */
export const modeState = {
  mode: "live", // 当前模式
  replay: null, // 回放配置（实盘模式下为 null）
};

// ============================================================================
// 模型信息
// ============================================================================

/**
 * 导出：模型详细信息列表
 * 用于模型选择器和信息展示
 */
export const models = [...MODELS, BASELINE].map((meta) => ({
  model_id: meta.id, // 模型 ID
  display_name: meta.name, // 显示名称
  description: "示例模型条目，接入真实后端时可替换为策略说明。", // 描述
  capabilities: ["趋势跟踪", "风控管理", "仓位调度"], // 能力标签
}));

// ============================================================================
// 排行榜数据
// ============================================================================

/**
 * 导出：模型排行榜数据
 * 包含 PNL、夏普比率、胜率、交易次数等关键指标
 */
export const leaderboard = MODELS.map((meta, index) => ({
  model: meta.name, // 模型名称
  pnl: [18.3, 15.4, 12.7, 9.1, 25.4, 21.3][index], // 累计收益率 (%)
  sharpe: [1.25, 1.11, 0.98, 0.84, 1.36, 1.28][index], // 夏普比率
  win: [63, 61, 58, 55, 69, 66][index], // 胜率 (%)
  trades: [128, 112, 97, 88, 156, 141][index], // 交易次数
}));

// ============================================================================
// 实验协议文档
// ============================================================================

/**
 * 导出：实验说明文档（Markdown 格式）
 * 用于 README.TXT 标签页展示
 */
export const experimentReadme = {
  title: "Alpha Arena - 样例实验协议", // 文档标题
  description_markdown: [
    "此页面用于演示 Alpha Arena 前端界面。",
    "正式接入后请在后端返回实验规则、资金上限、风险参数等 Markdown。",
  ].join("\n\n"), // Markdown 内容
  rules: {
    starting_capital_usd: 10000, // 起始资金
    market_type: "crypto_perpetuals", // 市场类型：加密货币永续合约
    objective: "风险收益兼顾", // 实验目标
    transparency: "所有模型决策和成交公开展示", // 透明度原则
    autonomy: "AI 提案可由人工确认或驳回", // 自主性原则
    duration: {
      start_ts: timeline[0], // 实验开始时间
      end_ts: timeline.at(-1), // 实验结束时间
    },
  },
};

// ============================================================================
// AI 模型日志
// ============================================================================

/**
 * 导出：AI 模型的公开日志
 * 用于展示模型的实时思考和决策过程
 */
export const agentsLogs = {
  logs: MODELS.map((meta, index) => ({
    model_id: meta.id, // 模型 ID
    timestamp: BASE_TS - (index + 1) * 10 * 60 * 1000, // 日志时间（每个模型间隔 10 分钟）
    public_message: `${meta.name} 当前保持策略，关注核心风险指标，这里为演示文案。`, // 公开消息
    positions_summary: [
      {
        symbol: COINS[index % COINS.length], // 持仓币种
        side: index % 2 === 0 ? "LONG" : "SHORT", // 方向：做多/做空
        leverage: [8, 6, 5, 4, 3, 7][index], // 杠杆倍数
        thesis: "示例策略说明，可替换为真实模型解释。", // 策略逻辑
        target: `${(COIN_PRICE[COINS[index % COINS.length]] * 1.08).toFixed(2)}`, // 目标价
        invalidation: "若关键支撑/阻力被突破则撤退。", // 止损条件
      },
    ],
    risk_notes: "演示用风险说明。", // 风险提示
  })),
};

// ============================================================================
// 持仓数据
// ============================================================================

/**
 * 导出：当前持仓详情
 * 包含每个模型的账户总览和具体持仓信息
 */
export const positionsCurrent = {
  serverTime: BASE_TS, // 服务器时间
  accountTotals: MODELS.map((meta, index) => ({
    model_id: meta.id, // 模型 ID
    timestamp: BASE_TS, // 数据时间戳
    dollar_equity: [12680.81, 11896.39, 11388.74, 10644.61, 14762.48, 13131.29][index], // 账户权益
    realized_pnl: [1680.81, 989.24, 738.33, 244.61, 2762.48, 2131.29][index], // 已实现盈亏
    total_unrealized_pnl: [420.12, 332.45, 286.13, 190.45, 512.76, 438.63][index], // 未实现盈亏
    cum_pnl_pct: Number(([12680.81, 11896.39, 11388.74, 10644.61, 14762.48, 13131.29][index] / 10000 - 1).toFixed(4)), // 累计收益率
    sharpe_ratio: [1.24, 1.12, 1.03, 0.87, 1.36, 1.28][index], // 夏普比率
    available_cash: [3200, 3100, 2950, 2800, 3600, 3400][index], // 可用资金
    positions: {
      [COINS[index % COINS.length]]: {
        symbol: COINS[index % COINS.length], // 持仓币种
        side: index % 2 === 0 ? "LONG" : "SHORT", // 方向
        leverage: [8, 6, 5, 4, 3, 7][index], // 杠杆
        quantity: [0.85, 6.2, 110, 45, 18000, 3400][index], // 持仓数量
        notional_usd: Number((COIN_PRICE[COINS[index % COINS.length]] * [0.85, 6.2, 110, 45, 18000, 3400][index]).toFixed(2)), // 名义价值
        entry_price: Number((COIN_PRICE[COINS[index % COINS.length]] * 0.97).toFixed(2)), // 开仓价格
        current_price: COIN_PRICE[COINS[index % COINS.length]], // 当前价格
        unrealized_pnl: [320.5, 210.3, 189.2, 112.6, 480.9, 398.7][index], // 未实现盈亏
        exit_plan: {
          profit_target: Number((COIN_PRICE[COINS[index % COINS.length]] * 1.08).toFixed(2)), // 止盈价
          stop_loss: Number((COIN_PRICE[COINS[index % COINS.length]] * 0.92).toFixed(2)), // 止损价
          invalidation_condition: "若关键趋势破位或波动率飙升。", // 止损条件
        },
      },
    },
  })),
};

// ============================================================================
// 交易历史
// ============================================================================

/**
 * 导出：最近完成的交易记录
 */
export const tradesRecent = {
  trades: [
    {
      model_id: "gpt-5", // 执行模型
      symbol: "BTC", // 交易币种
      side: "LONG", // 方向
      leverage: 6, // 杠杆
      quantity: 0.8, // 数量
      entry_price: 107200, // 开仓价
      exit_price: 109850, // 平仓价
      entry_time: BASE_TS - 12 * HOUR, // 开仓时间
      exit_time: BASE_TS - 4 * HOUR, // 平仓时间
      entry_human_time: "2024-10-30 12:00", // 开仓时间（可读）
      exit_human_time: "2024-10-30 20:00", // 平仓时间（可读）
      holding_time: "8 小时", // 持仓时长
      realized_net_pnl: 2120.4, // 净盈亏
      decision_source: "ai_auto", // 决策来源：AI 自动
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
      decision_source: "ai_proposed_human_approved", // 决策来源：AI 提议 + 人工批准
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
      decision_source: "human_manual", // 决策来源：人工手动
    },
  ],
};

/**
 * 导出：分页交易历史
 */
export const tradesHistory = {
  page: 1, // 当前页
  pageSize: 20, // 每页数量
  total: tradesRecent.trades.length, // 总条数
  trades: tradesRecent.trades, // 交易列表
};

/**
 * 导出：交易列表（简化版）
 */
export const trades = tradesRecent.trades;

// ============================================================================
// 待确认决策
// ============================================================================

/**
 * 导出：待人工确认的交易提案
 * 用于"需确认"标签页
 */
export const pendingDecisions = [
  {
    id: "pending-001", // 提案 ID
    modelId: "gemini-2-5-pro", // 提出模型
    asset: "ETH", // 目标资产
    side: "LONG", // 方向
    target: 4050, // 目标价
    stopLoss: 3700, // 止损价
    size: 8, // 仓位大小
    leverage: 5, // 杠杆
    timestamp: BASE_TS - 15 * 60 * 1000, // 提案时间
    comment: "计划在宏观数据公布前加仓 ETH，建议确认目标与止损。", // 说明
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

// ============================================================================
// 手动申请交易
// ============================================================================

/**
 * 导出：手动申请交易的资产列表
 * 用于"提交申请"标签页
 */
export const proposalAssets = COINS.map((symbol) => ({
  symbol, // 币种符号
  lastPrice: COIN_PRICE[symbol], // 当前价格
  side: "LONG", // 默认方向
  leverage: 4, // 默认杠杆
  notional: symbol === "BTC" ? 40000 : 10000, // 默认名义价值
  stopLoss: Number((COIN_PRICE[symbol] * 0.93).toFixed(symbol === "DOGE" ? 4 : 2)), // 建议止损价
  notes: "此处填写申请理由，提交将进入审批流程。", // 备注
}));
