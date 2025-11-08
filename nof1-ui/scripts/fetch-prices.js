/**
 * 市场价格获取脚本
 * 
 * 用途：从币安 API 获取实时加密货币价格并存储
 * 执行：node scripts/fetch-prices.js
 * 
 * 功能：
 * 1. 从币安公共 API 获取实时价格和 24 小时涨跌幅
 * 2. 存入 PostgreSQL 数据库（market_prices 表）
 * 3. 同步到 Redis 缓存（TTL 30 秒）
 * 4. 记录历史快照到 market_history 表（可选）
 * 
 * 支持模式：
 * - 单次执行：node scripts/fetch-prices.js
 * - 作为模块导入：require('./fetch-prices').fetchAndStorePrices()
 * - 定时任务：配合 cron 或 setInterval 使用
 */

/* eslint-disable no-console */
const { Pool } = require("pg");
const Redis = require("ioredis");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// ============================================================================
// 交易对配置
// ============================================================================

/**
 * 默认跟踪的加密货币交易对
 * 格式：币安交易对符号（USDT 计价）
 */
const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "DOGEUSDT", "XRPUSDT"];

/**
 * 解析环境变量中的交易对配置
 * @returns {string[]} 交易对数组
 * 
 * 优先级：
 * 1. MARKET_SYMBOLS 环境变量（逗号分隔）
 * 2. DEFAULT_SYMBOLS 常量
 */
function resolveSymbols() {
  try {
    const envSymbols = process.env.MARKET_SYMBOLS;
    if (envSymbols) {
      const parsed = envSymbols.split(",").map((s) => s.trim()).filter(Boolean);
      if (parsed.length > 0) {
        console.log(`使用环境变量配置的交易对: ${parsed.join(", ")}`);
        return parsed;
      }
    }
  } catch (err) {
    console.warn("解析 MARKET_SYMBOLS 失败，使用默认配置:", err.message);
  }
  console.log(`使用默认交易对: ${DEFAULT_SYMBOLS.join(", ")}`);
  return DEFAULT_SYMBOLS;
}

const symbols = resolveSymbols();

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 标准化交易对符号
 * @param {string} symbol - 原始交易对（如 BTCUSDT）
 * @returns {string} 标准化符号（如 BTC）
 * 
 * 用途：移除 USDT 后缀，便于前端展示
 */
function normalizeSymbol(symbol) {
  return symbol.replace(/USDT$/i, "");
}

// ============================================================================
// 数据库和 Redis 连接管理
// ============================================================================

/**
 * 创建 PostgreSQL 连接池
 * @returns {Pool} 数据库连接池实例
 * @throws {Error} 如果未配置 POSTGRES_URL
 */
function createPool() {
  if (!process.env.POSTGRES_URL) {
    throw new Error("环境变量 POSTGRES_URL 未配置，无法连接数据库。");
  }
  return new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
}

/**
 * 创建 Redis 客户端（可选）
 * @returns {Redis|null} Redis 客户端实例，未配置时返回 null
 */
function createRedis() {
  if (!process.env.REDIS_URL) {
    console.warn("REDIS_URL 未配置，将跳过 Redis 缓存同步。");
    return null;
  }
  return new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // 启用自动重连
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });
}

// ============================================================================
// 数据仓库加载（支持 ESM 模块）
// ============================================================================

/**
 * 动态加载数据仓库模块
 * @returns {Promise<Object>} dataRepository 实例
 * 
 * 原理：
 * 1. 将相对路径转为绝对路径
 * 2. 转换为 file:// URL
 * 3. 使用 dynamic import() 加载 ESM 模块
 */
async function loadDataRepository() {
  const repoPath = path.join(__dirname, "../lib/dataRepository.js");
  const repoUrl = pathToFileURL(repoPath).href;
  const mod = await import(repoUrl);
  return mod.dataRepository;
}

// ============================================================================
// 币安 API 调用
// ============================================================================

/**
 * 从币安 API 获取 24 小时行情数据
 * @param {string[]} symbolList - 交易对数组
 * @returns {Promise<Array>} 行情数据数组
 * 
 * API 端点：https://api.binance.com/api/v3/ticker/24hr
 * 
 * 返回字段：
 * - symbol: 交易对
 * - lastPrice: 最新价格
 * - priceChangePercent: 24h 涨跌幅（%）
 * - highPrice: 24h 最高价
 * - lowPrice: 24h 最低价
 * - volume: 24h 成交量
 */
async function fetchTickers(symbolList) {
  try {
    // 动态导入 dataRepository
    const dataRepository = await loadDataRepository();
    
    // 调用数据仓库的方法获取行情
    const tickers = await dataRepository.getTickers(symbolList);
    
    console.log(`成功获取 ${tickers.length} 个交易对的行情数据`);
    return tickers;
  } catch (error) {
    console.error("从币安 API 获取行情失败：", error.message);
    
    // 降级策略：返回模拟数据
    console.warn("使用 Mock 数据作为降级方案");
    return symbolList.map((symbol) => ({
      symbol,
      lastPrice: "0.00",
      priceChangePercent: "0.00",
      highPrice: "0.00",
      lowPrice: "0.00",
      volume: "0.00",
    }));
  }
}

// ============================================================================
// 数据持久化
// ============================================================================

/**
 * 将行情数据存入数据库和 Redis
 * @param {Pool} pool - 数据库连接池
 * @param {Redis|null} redis - Redis 客户端
 * @param {Array} tickers - 行情数据数组
 * 
 * 步骤：
 * 1. 遍历每个交易对
 * 2. UPSERT 到 market_prices 表（存在则更新）
 * 3. 同步到 Redis（TTL 30 秒）
 */
async function upsertTickers(pool, redis, tickers) {
  for (const ticker of tickers) {
    const {
      symbol,
      lastPrice,
      priceChangePercent,
      highPrice,
      lowPrice,
      volume,
    } = ticker;

    // 存入数据库
    await pool.query(
      `
      INSERT INTO market_prices(
        symbol, 
        price, 
        change_percent, 
        high_price, 
        low_price, 
        volume, 
        last_update_ts, 
        raw_payload,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, now(), $7::jsonb, now())
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
        symbol,
        parseFloat(lastPrice),
        parseFloat(priceChangePercent),
        parseFloat(highPrice),
        parseFloat(lowPrice),
        parseFloat(volume),
        JSON.stringify(ticker), // 存储完整的原始响应
      ]
    );

    // 同步到 Redis（如果配置）
    if (redis) {
      const cacheKey = `prices:${symbol}`;
      const cacheValue = JSON.stringify({
        symbol,
        price: parseFloat(lastPrice),
        changePercent: parseFloat(priceChangePercent),
        lastUpdateTs: Date.now(),
      });
      
      // 设置 30 秒 TTL
      await redis.set(cacheKey, cacheValue, "EX", 30);
    }
  }

  console.log(`✓ 已更新 ${tickers.length} 个交易对的价格数据`);
}

// ============================================================================
// 历史快照记录（可选）
// ============================================================================

/**
 * 将价格快照保存到历史表
 * @param {Array} tickers - 行情数据
 * 
 * 用途：用于回测、数据分析、绘制历史价格曲线
 * 
 * 注意：需要先创建 market_history 表
 * CREATE TABLE market_history (
 *   symbol TEXT,
 *   price NUMERIC,
 *   timestamp TIMESTAMP,
 *   PRIMARY KEY (symbol, timestamp)
 * );
 */
async function persistMarketHistorySnapshots(tickers) {
  // 此处为预留功能，需要根据实际需求实现
  // 示例：
  // for (const ticker of tickers) {
  //   await pool.query(
  //     'INSERT INTO market_history(symbol, price, timestamp) VALUES ($1, $2, now())',
  //     [ticker.symbol, parseFloat(ticker.lastPrice)]
  //   );
  // }
  console.log("历史快照功能未启用");
}

// ============================================================================
// 主函数（可作为模块导出）
// ============================================================================

/**
 * 获取并存储市场价格（主流程）
 * @param {Object} options - 配置选项
 * @param {Pool} [options.pool] - 数据库连接池（可选，不提供则自动创建）
 * @param {Redis} [options.redis] - Redis 客户端（可选）
 * @returns {Promise<void>}
 * 
 * 使用场景：
 * 1. 独立脚本：node scripts/fetch-prices.js
 * 2. API 路由：在 API 端点中调用更新价格
 * 3. 定时任务：setInterval(() => fetchAndStorePrices(), 60000)
 */
async function fetchAndStorePrices(options = {}) {
  const pool = options.pool || createPool();
  const redis = options.redis || createRedis();
  const shouldClosePool = !options.pool;  // 如果是自己创建的连接，需要关闭

  try {
    // 步骤 1：从币安 API 获取行情
    console.log(`正在获取 ${symbols.length} 个交易对的实时行情...`);
    const tickers = await fetchTickers(symbols);

    // 步骤 2：存入数据库和 Redis
    console.log("正在更新数据库和缓存...");
    await upsertTickers(pool, redis, tickers);

    // 步骤 3：记录历史快照（可选）
    if (process.env.ENABLE_MARKET_HISTORY === "true") {
      await persistMarketHistorySnapshots(tickers);
    }

    console.log("价格更新完成！");
  } catch (error) {
    console.error("价格更新失败：", error);
    throw error;
  } finally {
    // 仅关闭自己创建的连接
    if (shouldClosePool) {
      await pool.end();
    }
    if (redis && !options.redis) {
      await redis.quit();
    }
  }
}

// ============================================================================
// 命令行执行模式
// ============================================================================

/**
 * 作为独立脚本运行时的主函数
 */
async function main() {
  console.log("== 市场价格更新脚本 ==\n");
  
  try {
    await fetchAndStorePrices();
    console.log("\n== 更新成功 ==");
  } catch (error) {
    console.error("\n== 更新失败 ==");
    console.error(error);
    process.exit(1);
  }
}

// 检测是否为直接执行（非 require 导入）
if (require.main === module) {
  main();
}

// ============================================================================
// 模块导出
// ============================================================================

/**
 * 导出函数供其他模块使用
 * 
 * 使用示例：
 * const { fetchAndStorePrices } = require('./scripts/fetch-prices');
 * await fetchAndStorePrices({ pool: myPool, redis: myRedis });
 */
module.exports = {
  fetchAndStorePrices,    // 主函数
  normalizeSymbol,        // 工具函数：标准化交易对符号
  resolveSymbols,         // 工具函数：解析环境变量配置
};