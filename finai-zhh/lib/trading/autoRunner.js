import {
  listAgentModels,
  updateMarketPricesFromBinance,
  updateBtcBenchmark,
  markToMarketAllModels,
  markModelAutoRun,
  loadAllModelAllowedSymbols,
  getTrackedSymbols,
  initializeBtcBenchmark,
} from "../data/dataRepository.js";
import { runDecisionCycle } from "./decisionEngine.js";
import { logger } from "../infrastructure/logManager.js";
import { importMarketData, syncLatestMarketData } from "../market/marketImporter.js";
import { getPool } from "../infrastructure/db.js";
import { upsertRiskLimits } from "../data/simSettingsService.js";
import crypto from "node:crypto";

/**
 * ============================================================================
 * 自动运行器 - AI 模型定时调度系统
 * ============================================================================
 *
 * 功能说明：
 * 1. 定时扫描所有允许自动运行的模型（auto_run_enabled = true）
 * 2. 根据每个模型的运行间隔（auto_run_interval_minutes）决定是否执行
 * 3. 通过全局状态防止并发执行
 * 4. 将执行日志输出到 logManager / 控制台
 *
 * 设计原理：
 * - 使用 setInterval 作为定时器（默认每 5 秒一次，可通过环境变量调整）
 * - 每次 tick 先更新市场价格和 BTC 基准线，再检查模型是否需要运行
 *
 * 全局状态（globalThis.__autoRunner__）：
 * - started: 是否已经启动过定时器
 * - timer:   setInterval 返回的定时器句柄
 * - running: 当前是否正在执行 tick（用来防止并发执行）
 *
 * 相关环境变量：
 * - AUTO_RUNNER_TICK_MS: 自动 tick 间隔（毫秒），默认 5000
 * - AUTO_RUNNER_DISABLED: 为 "true" 时完全禁用自动运行
 *
 * 对外导出：
 * - ensureAutoRunner(): 确保自动调度器已经启动（可安全多次调用）
 *
 * ============================================================================
 */

/**
 * Auto-runner cadence configuration:
 * - AUTO_RUNNER_TICK_MS: interval (ms) between scheduler ticks (default 5_000)
 * - MARKET_LOOP_INTERVAL_MS: interval (ms) between market sync cycles (default 5_000)
 * - AUTO_RUNNER_DISABLED: set to "true" to disable both loops entirely
 */
/** 默认每 5 秒执行一次市场同步和模型调度（可通过环境变量覆盖） */
const DEFAULT_TICK_MS = (() => {
  const value = Number(process.env.AUTO_RUNNER_TICK_MS ?? 5000);
  if (!Number.isFinite(value) || value <= 0) {
    logger.warn("autoRunner", "AUTO_RUNNER_TICK_MS 非法，回退到 5000ms", {
      value: process.env.AUTO_RUNNER_TICK_MS,
    });
    return 5000;
  }
  return value;
})();
const MARKET_LOOP_INTERVAL_MS = (() => {
  const value = Number(process.env.MARKET_LOOP_INTERVAL_MS ?? 5000);
  if (!Number.isFinite(value) || value <= 0) {
    logger.warn("autoRunner", "MARKET_LOOP_INTERVAL_MS 非法，回退到 5000ms", {
      value: process.env.MARKET_LOOP_INTERVAL_MS,
    });
    return 5000;
  }
  return value;
})();
const AUTO_SYNC_RISK_MS = 60 * 60 * 1000; // 每 60 分钟后台同步一次分层/资金费
const HISTORY_SYNC_MS = 60 * 1000; // 每分钟同步一次完整行情快照
const ADVISORY_LOCK_NAMESPACE = 61001;
const LOCK_KEY_MARKET_LOOP = 1;
const LOCK_KEY_DISPATCH_TICK = 2;
const BINANCE_USE_TESTNET =
  process.env.BINANCE_TESTNET === "true" || !!process.env.BINANCE_API_KEY_TEST;
const BINANCE_FAPI_BASE = (() => {
  if (BINANCE_USE_TESTNET) {
    return process.env.BINANCE_FAPI_BASE_TEST || "https://testnet.binancefuture.com";
  }
  return process.env.BINANCE_FAPI_BASE || "https://fapi.binance.com";
})();
const BINANCE_API_KEY = BINANCE_USE_TESTNET
  ? process.env.BINANCE_API_KEY_TEST || process.env.BINANCE_API_KEY
  : process.env.BINANCE_API_KEY;
const BINANCE_API_SECRET = BINANCE_USE_TESTNET
  ? process.env.BINANCE_API_SECRET_TEST || process.env.BINANCE_API_SECRET
  : process.env.BINANCE_API_SECRET;

const globalState = globalThis.__autoRunner__ ?? {
  started: false,
  timer: null,
  running: false,
};

globalThis.__autoRunner__ = globalState;

const marketLoopState = globalThis.__marketLoop__ ?? {
  started: false,
  timer: null,
  running: false,
  lastRiskSyncTs: 0,
  lastHistorySyncTs: 0,
};

globalThis.__marketLoop__ = marketLoopState;

const runningModels =
  globalThis.__autoRunnerRunningModels ?? new Set();
globalThis.__autoRunnerRunningModels = runningModels;

export function isModelRunning(modelId) {
  if (!modelId) return false;
  return runningModels.has(modelId);
}

function ensureMarketSymbol(symbol) {
  if (!symbol) return symbol;
  const upper = String(symbol).toUpperCase();
  return upper.endsWith("USDT") ? upper : `${upper}USDT`;
}

let dispatcherConfigured = false;
let proxyAgent = null;

async function configureProxy() {
  if (dispatcherConfigured) return;
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (proxyUrl) {
    try {
      const { ProxyAgent } = await import("undici");
      proxyAgent = new ProxyAgent(proxyUrl);
    } catch (err) {
      logger.warn("autoRunner", "proxy setup failed", { error: err?.message });
    }
  }
  dispatcherConfigured = true;
}

async function fetchSignedBinanceJson(url) {
  if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
    throw new Error("BINANCE_API_KEY and BINANCE_API_SECRET are required for worker sync.");
  }
  await configureProxy();

  const doFetch = async (useProxy) => {
    const urlObj = new URL(url);
    urlObj.searchParams.set("timestamp", Date.now().toString());
    const qs = urlObj.searchParams.toString();
    const signature = crypto
      .createHmac("sha256", BINANCE_API_SECRET)
      .update(qs)
      .digest("hex");
    urlObj.searchParams.set("signature", signature);

    const resp = await fetch(urlObj.toString(), {
      dispatcher: useProxy && proxyAgent ? proxyAgent : undefined,
      headers: {
        "User-Agent": "Mozilla/5.0 (Binance Sync)",
        "X-MBX-APIKEY": BINANCE_API_KEY,
      },
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Binance request failed ${resp.status}: ${text || url}`);
    }
    return resp.json();
  };

  try {
    return await doFetch(true);
  } catch (error) {
    if (String(error?.message || "").includes("fetch failed")) {
      logger.warn("autoRunner", "proxy fetch failed, retrying without proxy", {
        error: error?.message,
      });
      return await doFetch(false);
    }
    throw error;
  }
}

async function syncRiskAndFunding(symbols = []) {
  const targets = symbols.map(ensureMarketSymbol);
  if (!targets.length) return;
  if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
    logger.warn("autoRunner", "缺少 Binance API 凭证，跳过风险/资金费同步", {
      symbols: targets,
    });
    return;
  }

  const riskEntries = [];
  const riskErrors = [];
  for (const symbol of targets) {
    try {
      const payload = await fetchSignedBinanceJson(
        `${BINANCE_FAPI_BASE}/fapi/v1/leverageBracket?symbol=${symbol}`
      );
      const brackets = Array.isArray(payload)
        ? payload[0]?.brackets ?? []
        : payload?.brackets ?? [];
      for (const item of brackets) {
        const tier = Number(item.bracket ?? 0);
        if (!Number.isFinite(tier) || tier <= 0) continue;
        const maxLeverage = Number(item.initialLeverage ?? 0);
        const notionalCap = Number(item.notionalCap ?? 0);
        const mmr = Number(item.maintMarginRatio ?? 0);
        if (!Number.isFinite(maxLeverage) || !Number.isFinite(notionalCap)) continue;
        riskEntries.push({
          symbol,
          tier,
          notional_cap: notionalCap,
          max_leverage: maxLeverage,
          imr: maxLeverage > 0 ? 1 / maxLeverage : 0,
          mmr: Number.isFinite(mmr) ? mmr : 0,
        });
      }
    } catch (error) {
      riskErrors.push({ symbol, error: error?.message });
    }
  }

  if (riskEntries.length) {
    await upsertRiskLimits(riskEntries);
  }
  if (riskErrors.length) {
    logger.warn("autoRunner", "风险分层同步部分失败", {
      failed: riskErrors.length,
      symbols: riskErrors.map((item) => item.symbol),
    });
  }

  const pool = getPool();
  let fundingUpdated = 0;
  try {
    for (const symbol of targets) {
      try {
        const payload = await fetchSignedBinanceJson(
          `${BINANCE_FAPI_BASE}/fapi/v1/premiumIndex?symbol=${symbol}`
        );
        const rate = Number(payload?.lastFundingRate ?? 0);
        if (!Number.isFinite(rate)) continue;
        const updated = await pool.query(
          `
          UPDATE market_prices
          SET funding_rate = $2, updated_at = now()
          WHERE symbol = $1
          `,
          [symbol, rate]
        );
        if (updated.rowCount === 0) {
          await pool.query(
            `
            INSERT INTO market_prices (
              symbol, price, change_percent, high_price, low_price, volume, funding_rate, last_update_ts, updated_at
            )
            VALUES ($1, 0, NULL, NULL, NULL, NULL, $2, now(), now())
            ON CONFLICT (symbol) DO UPDATE SET funding_rate = EXCLUDED.funding_rate, updated_at = now()
            `,
            [symbol, rate]
          );
        }
        fundingUpdated++;
      } catch (error) {
        logger.warn("autoRunner", "资金费同步失败", {
          symbol,
          error: error?.message,
        });
      }
    }
    logger.info("autoRunner", "风险/资金费同步完成", {
      symbols: targets,
      risk_rows: riskEntries.length,
      funding_updated: fundingUpdated,
    });
  } catch (error) {
    logger.warn("autoRunner", "风险/资金费同步失败", {
      error: error?.message,
      symbols: targets,
    });
  }
}

async function withAdvisoryLock(lockKey, fn) {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT pg_try_advisory_lock($1, $2) AS locked",
    [ADVISORY_LOCK_NAMESPACE, lockKey]
  );
  const locked = Boolean(rows?.[0]?.locked);
  if (!locked) {
    return { skipped: true };
  }

  try {
    const result = await fn();
    return { skipped: false, result };
  } finally {
    await pool.query("SELECT pg_advisory_unlock($1, $2)", [
      ADVISORY_LOCK_NAMESPACE,
      lockKey,
    ]);
  }
}

async function runMarketSyncCycle() {
  if (marketLoopState.running) return;
  marketLoopState.running = true;
  try {
    const lock = await withAdvisoryLock(LOCK_KEY_MARKET_LOOP, async () => {
    const now = Date.now();
    await loadAllModelAllowedSymbols();
    const symbols = getTrackedSymbols();

    if (symbols.length && now - (marketLoopState.lastHistorySyncTs ?? 0) >= HISTORY_SYNC_MS) {
      try {
        const syncResult = await syncLatestMarketData(symbols);
        const minuteInserted = syncResult.reduce(
          (sum, item) => sum + (item?.minuteInserted ?? 0),
          0
        );
        const htfInserted = syncResult.reduce(
          (sum, item) => sum + (item?.htfInserted ?? 0),
          0
        );
        logger.info("autoRunner", "历史行情同步完成", {
          symbols,
          minute_inserted: minuteInserted,
          htf_inserted: htfInserted,
        });
      } catch (historyError) {
        logger.warn("autoRunner", "历史行情同步失败", {
          error: historyError?.message,
          symbols,
        });
      } finally {
        marketLoopState.lastHistorySyncTs = now;
      }
    }

      await updateMarketPricesFromBinance();
      await updateBtcBenchmark();
      await markToMarketAllModels();


      const riskNow = Date.now();
      if (riskNow - (marketLoopState.lastRiskSyncTs ?? 0) >= AUTO_SYNC_RISK_MS) {
        marketLoopState.lastRiskSyncTs = riskNow;
        const symbols = getTrackedSymbols();
        syncRiskAndFunding(symbols)
          .then(() =>
            logger.info("autoRunner", "定时同步风险/资金费完成", {
              symbols,
              interval_ms: AUTO_SYNC_RISK_MS,
            })
          )
          .catch((err) =>
            logger.warn("autoRunner", "定时同步风险/资金费失败", {
              error: err?.message,
              symbols,
            })
          );
      }
    });
    if (lock.skipped) {
      logger.info("autoRunner", "市场循环跳过：锁已被其他 worker 持有");
    }

  } catch (error) {
    logger.warn("autoRunner", "市场循环刷新失败", {
      error: error.message,
    });
  } finally {
    marketLoopState.running = false;
  }
}

function ensureMarketLoop() {
  if (marketLoopState.started) return;
  marketLoopState.started = true;
  const bootstrap = async () => {
    try {
      // 初始化基准线模型（直调，避免 fetch 失败）
      await updateMarketPricesFromBinance({ forceUniverseRefresh: true });
      await initializeBtcBenchmark();
      await updateBtcBenchmark();
    } catch (err) {
      logger.warn("autoRunner", "基准模型初始化失败", { error: err?.message });
    }
    await loadAllModelAllowedSymbols();
    const symbols = getTrackedSymbols();
    if (symbols.length) {
      try {
        await importMarketData(symbols);
        marketLoopState.lastHistorySyncTs = Date.now();
      } catch (err) {
        logger.warn("autoRunner", "初始行情导入失败", { error: err?.message });
      }
    }
    // 启动时强制一次风险/资金费同步
    try {
      const syncSymbols = getTrackedSymbols().map((s) => s.toUpperCase());
      if (syncSymbols.length) {
        await syncRiskAndFunding(syncSymbols);
      }
    } catch (err) {
      logger.warn("autoRunner", "初始风险/资金费同步失败", {
        error: err?.message,
      });
    }
  };
  marketLoopState.timer = setInterval(runMarketSyncCycle, MARKET_LOOP_INTERVAL_MS);
  bootstrap()
    .then(() => runMarketSyncCycle())
    .catch((error) => logger.error("autoRunner", "初始市场同步失败", { error: error?.message }));
}
/**
 * 执行一次自动轮询 tick（自动运行所有开启 auto_run 的模型）。
 *
 * 流程：
 * 1. 加锁（globalState.running），防止并发执行
 * 2. 更新市场价格 & BTC 基准线
 * 3. 拉取所有模型，筛选出开启 auto_run 的模型
 * 4. 检查是否已经到达该模型的下一次执行时间
 * 5. 校验模型是否配置 API key
 * 6. 调用 runDecisionCycle 执行该模型的一次决策循环
 * 7. 捕获并记录任何错误，保证单个模型失败不会影响其他模型
 */
async function tick() {
  // 步骤 1：如果上一次 tick 还在运行中，直接跳过，避免并发
  if (globalState.running) return;
  globalState.running = true;

  try {
    const lock = await withAdvisoryLock(LOCK_KEY_DISPATCH_TICK, async () => {
    // 步骤 1.5：每次 tick 优先尝试刷新市场价格与 BTC 基准线
    try {
      await updateMarketPricesFromBinance();
      await updateBtcBenchmark();
    } catch (priceError) {
      logger.warn("autoRunner", "市场价格更新失败", {
        error: priceError.message,
      });
      // 报价更新失败不影响后续策略模型的执行，仅记录日志
    }

    // 步骤 2：对所有模型做一次 mark-to-market，保证权益数据是最新的
    try {
      const mtmResult = await markToMarketAllModels();
      if (mtmResult?.updated?.length) {
       
      }
      if (mtmResult?.snapshots?.length) {
       
      }
    } catch (mtmError) {
      logger.warn("autoRunner", "基准估值失败", {
        error: mtmError.message,
      });
    }

    // 拉取所有 Agent 模型配置（包含密钥信息）
    const models = await listAgentModels({ includeSecrets: true });

    // 只保留开启了 auto_run 的模型
    const runnable = models.filter((model) => model.auto_run_enabled);

    // 当前时间戳（毫秒）
    const now = Date.now();

    // 步骤 3：并行处理可自动运行的模型，runningModels 仍防重入
  const tasks = runnable.map(async (model) => {
    // 该模型的自动轮询间隔（毫秒），默认 5 分钟
    const intervalMs = (model.auto_run_interval_minutes || 5) * 60 * 1000;

      // 取出上一次自动运行时间；从未运行过则视为 0
      const lastRun = model.last_auto_run_at
        ? new Date(model.last_auto_run_at).getTime()
        : 0;

    // 如果已经运行过，且距离上次运行未到达设定的间隔，则跳过本次
    // 预留 1000ms 的 buffer，避免边界时间导致的抖动问题
    if (lastRun && now - lastRun < intervalMs - 1000) {
        return;
    }

      // 步骤 4：校验 API 证书（没有 key 的模型不能自动运行）
    if (!model.api_key) {
      logger.warn("autoRunner", "模型已开启自动运行但缺少 API Key，跳过自动运行", {
        model_id: model.model_id,
      });
        return;
    }

      // 步骤 5：对该模型执行一次完整的自动决策循环
      if (runningModels.has(model.model_id)) return;
      runningModels.add(model.model_id);
      try {
        const startAt = Date.now();
        const result = await runDecisionCycle(model.model_id, {
          source: "auto_cycle",
        });
        const elapsed = Date.now() - startAt;
        logger.info("autoRunner", "自动运行完成", {
          model_id: model.model_id,
          elapsed_ms: elapsed,
          decision_count:
            Array.isArray(result?.decisions) && result.decisions.length
              ? result.decisions.length
              : Object.keys(result?.decisions ?? {}).length || 0,
          skipped: result?.skipped ?? false,
        });
      } catch (err) {
        logger.error("autoRunner", "模型自动运行失败", {
          model_id: model.model_id,
          error: err?.message,
          stack: err?.stack,
        });
      } finally {
        runningModels.delete(model.model_id);
      }
    });

    await Promise.allSettled(tasks);
    });
    if (lock.skipped) {
      logger.info("autoRunner", "调度 tick 跳过：锁已被其他 worker 持有");
    }
  } catch (error) {
    // 若出现意料之外的顶层异常（例如数据库不可用等），统一在此兜底
    logger.error("autoRunner", "tick error", { error: error?.message });
  } finally {
    // 释放运行标记，允许下一次 tick 执行
    globalState.running = false;
  }
}

/**
 * 确保自动调度器（auto runner）已经启动并在运行中。
 *
 * 特性：
 * - 可多次调用：只会在第一次调用时真正启动，后续调用直接返回
 * - 可通过环境变量 AUTO_RUNNER_DISABLED 关闭自动运行
 * - 启动时会立即执行一次 tick，而不是只等下一次定时器
 */
export function ensureAutoRunner() {
  // 如果通过环境变量显式关闭了自动调度，则直接返回
  if (process.env.AUTO_RUNNER_DISABLED === "true") {
    return;
  }

  // 确保市场价格轮询（或其他前置循环）已启动
  ensureMarketLoop();

  // 如果已经启动过 auto runner，则不重复启动
  if (globalState.started) return;

  // 标记已启动，并创建定时器，按固定间隔执行 tick
  globalState.started = true;
  globalState.timer = setInterval(tick, DEFAULT_TICK_MS);

  // 启动时立即执行一次 tick，而不是只等待第一个间隔
  tick().catch((error) =>
    logger.error("autoRunner", "initial tick failed", { error: error?.message }),
  );
}
