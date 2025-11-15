/**
 * ============================================================================
 * 提示词构建器 - AI 决策提示词动态生成模块
 * ============================================================================
 * 
 * 功能说明:
 * 1. 构建发送给 LLM 的提示词中的动态占位符替换值
 * 2. 收集市场数据 (价格、指标、K线历史)
 * 3. 收集账户信息 (余额、持仓、收益率)
 * 4. 格式化数据为易读的文本格式
 * 
 * 核心导出函数:
 * - buildMarketStateText(): 构建市场状态文本 (价格、指标、时序数据)
 * - buildPositionStateText(): 构建持仓状态文本 (账户余额、持仓详情)
 * - buildPromptReplacements(): 构建所有占位符的完整替换映射
 * 
 * 提示词模板示例:
 *   系统提示词: "你是专业的量化交易分析师..."
 *   用户提示词: "当前时间: {current_time}\n市场数据:\n{market_state_text}\n持仓信息:\n{position_state_text}"
 *   
 *   替换后:
 *   "当前时间: 2025-11-09T10:30:00.000Z
 *    市场数据:
 *    ### ALL BTCUSDT DATA
 *    current_price = 67850.5, current_ema20 = 67200.3, ...
 *    持仓信息:
 *    ### HERE IS YOUR ACCOUNT INFORMATION & PERFORMANCE
 *    Current Total Return (percent): 12.45
 *    Available Cash: 11245.67
 *    ..."
 * 
 * ============================================================================
 */

import {
  countAgentLogs,
  getMarketSeries,
  getMarketSnapshot,
  getOpenPositions,
  getRuntimeAccount,
  getTrackedSymbols,
} from "./dataRepository.js";

// ============================================================================
// 常量配置
// ============================================================================

/** 默认的分钟级时间框架 (用于短期趋势分析) */
const DEFAULT_MINUTE_FRAME = "1m";

/** 默认的高时间框架 (用于长期趋势分析) */
const DEFAULT_HTF_FRAME = "4h";

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 格式化数字为固定小数位
 * 
 * 用途:
 * - 确保输出数字的一致性 (避免科学计数法)
 * - 减少提示词长度 (只保留必要精度)
 * 
 * @param {number|string} value - 待格式化的数值
 * @param {number} digits - 保留的小数位数 (默认 3)
 * @returns {string} 格式化后的字符串 (如 "1234.567")
 * 
 * 示例:
 *   formatNumber(1234.56789, 3) → "1234.568"
 *   formatNumber(null, 3) → "0"
 *   formatNumber("abc", 3) → "0"
 */
function formatNumber(value, digits = 3) {
  if (value == null || Number.isNaN(Number(value))) return "0";
  const factor = 10 ** digits;
  return (Math.round(Number(value) * factor) / factor).toString();
}

/**
 * 格式化数值数组为紧凑字符串
 * 
 * 用途:
 * - 将时序数据 (如价格历史) 压缩为一行文本
 * - 减少提示词 token 消耗
 * 
 * @param {number[]} values - 数值数组
 * @param {number} digits - 保留的小数位数 (默认 3)
 * @returns {string} 格式化后的数组字符串 (如 "[1.23, 4.56, 7.89]")
 * 
 * 示例:
 *   formatSeries([1.234, 5.678, 9.012], 2) → "[1.23, 5.68, 9.01]"
 *   formatSeries([], 3) → "[]"
 */
function formatSeries(values, digits = 3) {
  if (!values || !values.length) return "[]";
  return `[${values.map((val) => formatNumber(val, digits)).join(", ")}]`;
}

/**
 * 提取数组的最后 N 个元素
 * 
 * 用途:
 * - 限制时序数据的长度 (只取最近的数据)
 * - 避免提示词过长
 * 
 * @param {any[]} values - 原始数组
 * @param {number} count - 需要提取的元素数量 (默认 10)
 * @returns {any[]} 最后 N 个元素
 * 
 * 示例:
 *   takeLast([1, 2, 3, 4, 5], 3) → [3, 4, 5]
 *   takeLast([1, 2], 10) → [1, 2]
 */
function takeLast(values, count = 10) {
  if (!Array.isArray(values) || !values.length) return [];
  return values.slice(Math.max(values.length - count, 0));
}

/**
 * 从数据库加载指定交易对和时间框架的时序数据
 * 
 * 流程:
 * 1. 查询数据库获取最近 limit 条 K线数据
 * 2. 提取最后 10 条 (避免提示词过长)
 * 
 * @param {string} symbol - 交易对符号 (如 'BTCUSDT')
 * @param {string} timeframe - 时间框架 (如 '1m', '4h')
 * @param {number} limit - 查询的最大条数 (默认 40)
 * @returns {Promise<Array>} 时序数据数组 (每个元素包含 price_mid, ema20, macd, rsi_7 等)
 */
async function loadSeries(symbol, timeframe, limit = 40) {
  const series = await getMarketSeries(symbol, timeframe, { limit });
  return takeLast(series, 10); // 只取最后 10 条
}


// ============================================================================
// 市场数据格式化函数
// ============================================================================

/**
 * 格式化单个交易对的完整市场数据为文本
 * 
 * 输出格式示例:
 * ```
 * ### ALL BTCUSDT DATA
 * current_price = 67850.5, current_ema20 = 67200.3, current_macd = 123.45, current_rsi (7 period) = 62.3
 * In addition, here is the latest open interest and funding rate for perps (the instrument you are trading):
 * Open Interest: Latest: 1234567890 Average: 1200000000
 * Funding Rate: 0.000125
 * Intraday series (by minute, oldest → latest):
 * Mid prices: [67800, 67820, 67850, ...]
 * EMA indicators (20-period): [67150, 67180, 67200, ...]
 * MACD indicators: [120, 122, 123, ...]
 * RSI indicators (7-Period): [60, 61, 62, ...]
 * RSI indicators (14-Period): [55, 56, 58, ...]
 * Longer-term context (4-hour timeframe):
 * 20-Period EMA: 67100 vs. 50-Period EMA: 66800
 * 3-Period ATR: 450 vs. 14-Period ATR: 520
 * Current Volume: 12345678 vs. Average Volume: 11000000
 * MACD indicators: [100, 110, 115, ...]
 * RSI indicators (14-Period): [52, 54, 55, ...]
 * ```
 * 
 * @param {string} symbol - 交易对符号 (如 'BTCUSDT')
 * @param {Object} snapshot - 当前市场快照数据
 * @param {Array} minuteSeries - 分钟级时序数据 (最近 10 条)
 * @param {Array} htfSeries - 高时间框架时序数据 (最近 10 条)
 * @returns {string} 格式化后的市场数据文本
 */
function formatMarketSection(symbol, snapshot, minuteSeries, htfSeries) {
  // 获取最新的 K线数据
  const latestMinute = minuteSeries.at(-1) ?? {};
  const latestHtf = htfSeries.at(-1) ?? {};
  
  // 构建标题
  const title = `### ALL ${symbol.toUpperCase()} DATA`;
  
  // 构建各个数据行
  const lines = [
    `${title}`,
    // 当前价格和主要指标
    `current_price = ${formatNumber(snapshot?.price ?? 0)}, current_ema20 = ${formatNumber(
      snapshot?.ema20 ?? 0
    )}, current_macd = ${formatNumber(snapshot?.macd ?? 0)}, current_rsi (7 period) = ${formatNumber(
      snapshot?.rsi_7 ?? 0
    )}`,
    
    // 永续合约特有数据 (持仓量和资金费率)
    "In addition, here is the latest open interest and funding rate for perps (the instrument you are trading):",
    `Open Interest: Latest: ${formatNumber(snapshot?.open_interest ?? 0)} Average: ${formatNumber(
      snapshot?.open_interest_avg ?? 0
    )}`,
    `Funding Rate: ${formatNumber(snapshot?.funding_rate ?? 0, 6)}`, // 资金费率精度更高
    
    // 分钟级时序数据 (短期趋势)
    "Intraday series (by minute, oldest → latest):",
    `Mid prices: ${formatSeries(minuteSeries.map((row) => row.price_mid))}`,
    `EMA indicators (20-period): ${formatSeries(minuteSeries.map((row) => row.ema20))}`,
    `MACD indicators: ${formatSeries(minuteSeries.map((row) => row.macd))}`,
    `RSI indicators (7-Period): ${formatSeries(minuteSeries.map((row) => row.rsi_7))}`,
    `RSI indicators (14-Period): ${formatSeries(minuteSeries.map((row) => row.rsi_14))}`,
    
    // 4小时级别数据 (长期趋势)
    "Longer-term context (4-hour timeframe):",
    `20-Period EMA: ${formatNumber(latestHtf?.ema20 ?? 0)} vs. 50-Period EMA: ${formatNumber(
      latestHtf?.ema50 ?? 0
    )}`,
    `3-Period ATR: ${formatNumber(latestHtf?.atr_3 ?? 0)} vs. 14-Period ATR: ${formatNumber(
      latestHtf?.atr_14 ?? 0
    )}`, // ATR (Average True Range) 波动率指标
    `Current Volume: ${formatNumber(snapshot?.volume ?? latestMinute?.volume ?? 0)} vs. Average Volume: ${formatNumber(
      snapshot?.volume_avg ?? latestMinute?.volume_avg ?? 0
    )}`,
    `MACD indicators: ${formatSeries(htfSeries.map((row) => row.macd))}`,
    `RSI indicators (14-Period): ${formatSeries(htfSeries.map((row) => row.rsi_14))}`,
    "",
  ];
  
  return lines.join("\n");
}

/**
 * 构建所有交易对的市场状态文本
 * 
 * 用途:
 * - 生成 {market_state_text} 占位符的替换值
 * - 提供给 LLM 完整的市场数据上下文
 * 
 * 数据来源:
 * - market_snapshots 表: 当前价格、指标、持仓量、资金费率
 * - market_series 表: 历史 K线数据 (1分钟和4小时)
 * 
 * @param {string[]} symbols - 交易对列表 (默认使用全局追踪列表)
 * @returns {Promise<string>} 完整的市场状态文本
 * 
 * 输出格式:
 *   每个交易对一个 section (由 formatMarketSection 生成)
 *   多个 section 之间用换行分隔
 */
export async function buildMarketStateText(symbols = getTrackedSymbols()) {
  // 获取所有交易对的最新快照
  const snapshot = await getMarketSnapshot();
  
  // 并行加载每个交易对的时序数据和格式化
  const sections = await Promise.all(
    symbols.map(async (symbol) => {
      const priceRow = snapshot.prices[symbol]; // 当前快照
      
      // 并行加载两个时间框架的数据
      const [minuteSeries, htfSeries] = await Promise.all([
        loadSeries(symbol, DEFAULT_MINUTE_FRAME, 40), // 最近 40 分钟数据
        loadSeries(symbol, DEFAULT_HTF_FRAME, 20),    // 最近 20 个 4小时 K线
      ]);
      
      return formatMarketSection(symbol, priceRow, minuteSeries, htfSeries);
    })
  );
  
  return sections.join("\n"); // 合并所有 section
}


// ============================================================================
// 持仓数据格式化函数
// ============================================================================

/**
 * 构建账户和持仓状态文本
 * 
 * 用途:
 * - 生成 {position_state_text} 占位符的替换值
 * - 向 LLM 提供账户余额、收益率和当前持仓详情
 * 
 * 输出格式示例:
 * ```
 * ### HERE IS YOUR ACCOUNT INFORMATION & PERFORMANCE
 * Current Total Return (percent): 12.45
 * Available Cash: 11245.67
 * Current Account Value: 12245.67
 * Current live positions & performance: {"symbol":"BTCUSDT","quantity":0.5,"entry_price":67000,...} {"symbol":"ETHUSDT",...}
 * ```
 * 
 * 或者无持仓时:
 * ```
 * ### HERE IS YOUR ACCOUNT INFORMATION & PERFORMANCE
 * Current Total Return (percent): -2.34
 * Available Cash: 9766.00
 * Current Account Value: 9766.00
 * Current live positions & performance: 无持仓。
 * ```
 * 
 * @param {string} modelId - 模型唯一标识符
 * @returns {Promise<string>} 格式化后的持仓状态文本
 * 
 * 数据来源:
 * - runtime_accounts 表: 账户余额、起始资金、最新净值
 * - runtime_positions 表: 当前持仓详情
 */
export async function buildPositionStateText(modelId) {
  // 并行加载账户和持仓数据
  const [account, positions] = await Promise.all([
    getRuntimeAccount(modelId),
    getOpenPositions(modelId),
  ]);
  
  // ------------------------------------------------------------------------
  // 计算总收益率
  // ------------------------------------------------------------------------
  const startingEquity = account?.starting_equity ?? 10000; // 起始资金 (默认 $10,000)
  const latestEquity = account?.latest_equity ?? startingEquity; // 当前净值
  
  // 收益率 = (当前净值 - 起始资金) / 起始资金 * 100
  const pctReturn =
    startingEquity > 0 ? ((latestEquity - startingEquity) / startingEquity) * 100 : 0;

  // ------------------------------------------------------------------------
  // 构建基础信息行
  // ------------------------------------------------------------------------
  const lines = [
    "### HERE IS YOUR ACCOUNT INFORMATION & PERFORMANCE",
    `Current Total Return (percent): ${formatNumber(pctReturn, 2)}`, // 总收益率 (%)
    `Available Cash: ${formatNumber(account?.available_cash ?? latestEquity, 2)}`, // 可用余额
    `Current Account Value: ${formatNumber(latestEquity, 2)}`, // 账户总价值
  ];

  // ------------------------------------------------------------------------
  // 处理持仓数据
  // ------------------------------------------------------------------------
  if (!positions.length) {
    // 无持仓时
    lines.push("Current live positions & performance: 无持仓。");
    return lines.join("\n");
  }

  // 序列化所有持仓为 JSON 字符串 (一行一个持仓)
  const serialized = positions
    .map((position) =>
      JSON.stringify({
        symbol: position.symbol,                    // 交易对
        quantity: position.quantity,                // 持仓数量 (正数=多头, 负数=空头)
        entry_price: position.entry_price,          // 入场价格
        current_price: position.current_price,      // 当前价格
        liquidation_price: position.liquidation_price, // 强平价格
        unrealized_pnl: position.unrealized_pnl,    // 未实现盈亏
        leverage: position.leverage,                // 杠杆倍数
        exit_plan: position.exit_plan,              // 退出计划
        confidence: position.confidence,            // 信心度 (0-1)
        risk_usd: position.risk_usd,                // 风险金额 (USD)
        sl_oid: position.sl_oid,                    // 止损订单 ID
        tp_oid: position.tp_oid,                    // 止盈订单 ID
        entry_oid: position.entry_oid,              // 入场订单 ID
        wait_for_fill: position.wait_for_fill,      // 是否等待成交
        notional_usd: position.notional_usd ?? position.notional, // 名义价值 (USD)
      })
    )
    .join(" "); // 用空格分隔多个持仓

  lines.push(`Current live positions & performance: ${serialized}`);
  return lines.join("\n");
}


// ============================================================================
// 完整提示词替换映射构建函数
// ============================================================================

/**
 * 构建提示词模板的所有占位符替换值
 * 
 * 用途:
 * - 生成完整的占位符 → 实际值 映射
 * - 供 decisionEngine 填充提示词模板使用
 * 
 * 支持的占位符:
 * - {minutes_since_start}: 模型创建以来的分钟数
 * - {current_time}: 当前 ISO 8601 时间戳
 * - {num_invocations}: 模型调用次数 (agent_logs 表记录数)
 * - {market_state_text}: 完整市场数据文本
 * - {position_state_text}: 账户和持仓信息文本
 * - {sharpe_ratio}: 夏普比率 (风险调整后收益指标)
 * - {available_cash}: 可用余额 (USD)
 * - {latest_equity}: 账户总价值 (USD)
 * 
 * @param {Object} model - 模型配置对象
 * @param {string} model.model_id - 模型唯一标识符
 * @param {string} model.created_at - 模型创建时间
 * @param {Object} options - 可选配置
 * @param {string[]} options.symbols - 交易对列表 (默认使用全局追踪列表)
 * 
 * @returns {Promise<Object>} 占位符替换映射
 * 
 * 返回值示例:
 * ```javascript
 * {
 *   minutes_since_start: 1234,
 *   current_time: "2025-11-09T10:30:00.000Z",
 *   num_invocations: 45,
 *   market_state_text: "### ALL BTCUSDT DATA\ncurrent_price = 67850.5...",
 *   position_state_text: "### HERE IS YOUR ACCOUNT INFORMATION...",
 *   sharpe_ratio: "1.245",
 *   available_cash: "11245.67",
 *   latest_equity: "12245.67"
 * }
 * ```
 * 
 * 数据流:
 * 1. 并行加载: 市场数据 + 持仓数据 + 账户信息 + 调用次数
 * 2. 格式化所有数值为字符串 (确保精度)
 * 3. 返回完整映射对象
 */
export async function buildPromptReplacements(model, options = {}) {
  // ------------------------------------------------------------------------
  // 步骤 1: 准备基础数据
  // ------------------------------------------------------------------------
  const now = new Date();
  const symbols = options.symbols ?? getTrackedSymbols();
  
  // 并行加载所有必需的数据 (优化性能)
  const [marketStateText, positionStateText, account, invocationCount] = await Promise.all([
    buildMarketStateText(symbols),          // 市场数据文本
    buildPositionStateText(model.model_id), // 持仓数据文本
    getRuntimeAccount(model.model_id),      // 账户信息
    countAgentLogs(model.model_id),         // 调用次数
  ]);

  // ------------------------------------------------------------------------
  // 步骤 2: 计算时间相关变量
  // ------------------------------------------------------------------------
  const sharpe = account?.sharpe_ratio ?? 0; // 夏普比率 (默认 0)
  
  // 计算模型创建以来的分钟数
  const startedAt = model.created_at ? new Date(model.created_at) : now;
  const minutesSinceStart = Math.max(0, Math.floor((now - startedAt) / 60000));

  // ------------------------------------------------------------------------
  // 步骤 3: 返回完整的替换映射
  // ------------------------------------------------------------------------
  return {
    minutes_since_start: minutesSinceStart,   // 运行时长 (分钟)
    current_time: now.toISOString(),          // ISO 8601 格式时间
    num_invocations: invocationCount,         // 调用次数
    market_state_text: marketStateText,       // 完整市场数据
    position_state_text: positionStateText,   // 完整持仓数据
    sharpe_ratio: formatNumber(sharpe, 3),    // 夏普比率 (3 位小数)
    available_cash: formatNumber(account?.available_cash ?? 0, 2), // 可用余额 (2 位小数)
    latest_equity: formatNumber(
      account?.latest_equity ?? account?.starting_equity ?? 10000, 
      2
    ), // 账户总价值 (2 位小数)
  };
}
