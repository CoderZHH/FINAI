import {
  listAgentModels,
  updateMarketPricesFromBinance,
  updateBtcBenchmark,
  markToMarketAllModels,
  markModelAutoRun,
  loadAllModelAllowedSymbols,
  getTrackedSymbols,
  initializeBtcBenchmark,
} from "./dataRepository.js";
import { runDecisionCycle } from "./decisionEngine.js";
import { logger } from "./logManager.js";
import { upsertRiskLimits } from "./simSettingsService.js";
import { getPool } from "./db.js";
import crypto from "node:crypto";
import { importMarketData, syncLatestMarketData } from "./marketImporter.js";

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
  const value = Number(process.env.AUTO_RUNNER_TICK_MS);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("AUTO_RUNNER_TICK_MS is required (ms).");
  }
  return value;
})();
const MARKET_LOOP_INTERVAL_MS = (() => {
  const value = Number(process.env.MARKET_LOOP_INTERVAL_MS);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("MARKET_LOOP_INTERVAL_MS is required (ms).");
  }
  return value;
})();
const BINANCE_FAPI_BASE = (() => {
  const base = process.env.BINANCE_FAPI_BASE;
  if (!base) throw new Error("BINANCE_FAPI_BASE is required.");
  return base;
})();
const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;
const AUTO_SYNC_RISK_MS = 60 * 60 * 1000; // 每 60 分钟后台同步一次分层/资金费
const HISTORY_SYNC_MS = 60 * 1000; // 每分钟同步一次完整行情快照

let dispatcherConfigured = false;

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

async function fetchJson(url) {
  if (!API_KEY || !API_SECRET) {
    throw new Error("Binance API key/secret missing (BINANCE_API_KEY / BINANCE_API_SECRET).");
  }
  if (!dispatcherConfigured) {
    const proxyUrl =
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy;
    try {
      const { ProxyAgent, setGlobalDispatcher, fetch: undiciFetch } = await import("undici");
      if (proxyUrl) {
        setGlobalDispatcher(new ProxyAgent(proxyUrl));
        globalThis.__binanceFetch__ = undiciFetch;
      }
    } catch (err) {
      console.warn("[autoRunner] proxy setup failed", err?.message);
    }
    dispatcherConfigured = true;
  }
  const doFetch = async (useProxy) => {
    if (!useProxy) delete globalThis.__binanceFetch__;
    const fetchImpl = useProxy && globalThis.__binanceFetch__ ? globalThis.__binanceFetch__ : fetch;
    const urlObj = new URL(url);
    urlObj.searchParams.set("timestamp", Date.now().toString());
    const qs = urlObj.searchParams.toString();
    const signature = crypto.createHmac("sha256", API_SECRET).update(qs).digest("hex");
    urlObj.searchParams.set("signature", signature);

    const resp = await fetchImpl(urlObj.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (AutoRunner Binance Sync)",
        "X-MBX-APIKEY": API_KEY,
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

async function callInternalApi(path, { method = "POST" } = {}) {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const url = new URL(path, base);
  const resp = await fetch(url.toString(), { method });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Internal API ${path} failed ${resp.status}: ${text || "unknown error"}`);
  }
  return resp.json();
}

async function syncRiskAndFunding(symbols = []) {
  const targets = symbols.map(ensureMarketSymbol);
  if (!targets.length) return;
  const qs = encodeURIComponent(targets.join(","));
  try {
    await callInternalApi(`/api/binance/risk?symbols=${qs}`);
  } catch (error) {
    logger.warn("autoRunner", "Risk sync via API failed", { error: error?.message });
  }
  try {
    await callInternalApi(`/api/binance/funding?symbols=${qs}`);
  } catch (error) {
    logger.warn("autoRunner", "Funding sync via API failed", { error: error?.message });
  }
}

async function runMarketSyncCycle() {
  if (marketLoopState.running) return;
  marketLoopState.running = true;
  try {
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
        logger.info("autoRunner", "Market history synced", {
          symbols: symbols.length,
          minute_inserted: minuteInserted,
          htf_inserted: htfInserted,
        });
      } catch (historyError) {
        logger.warn("autoRunner", "Market history sync failed", {
          error: historyError?.message,
        });
      } finally {
        marketLoopState.lastHistorySyncTs = now;
      }
    }

    const updated = await updateMarketPricesFromBinance();
    logger.info("autoRunner", "Market loop refreshed prices", {
      symbols_updated: updated,
      loop: "market",
    });

    const benchmark = await updateBtcBenchmark();
    if (benchmark) {
      logger.info("autoRunner", "BTC benchmark marked-to-market", {
        equity: benchmark.equity,
        return_percent:
          benchmark.returnPercent != null
            ? benchmark.returnPercent.toFixed(2) + "%"
            : undefined,
      });
    }

    const mtmResult = await markToMarketAllModels();
    if (mtmResult?.updated?.length) {
      logger.info("autoRunner", "Mark-to-market applied", {
        models: mtmResult.updated,
        loop: "market",
      });
    }
    if (mtmResult?.snapshots?.length) {
      logger.info("autoRunner", "Equity snapshots captured", {
        snapshot_count: mtmResult.snapshots.length,
        loop: "market",
      });
    }

    const riskNow = Date.now();
    if (riskNow - (marketLoopState.lastRiskSyncTs ?? 0) >= AUTO_SYNC_RISK_MS) {
      marketLoopState.lastRiskSyncTs = riskNow;
      const symbols = getTrackedSymbols();
      syncRiskAndFunding(symbols)
        .then(() =>
          logger.info("autoRunner", "Risk/Funding auto-synced", {
            symbols: symbols.length,
          })
        )
        .catch((err) =>
          logger.warn("autoRunner", "Risk/Funding auto-sync failed", {
            error: err?.message,
          })
        );
    }

  } catch (error) {
    logger.warn("autoRunner", "Market sync loop failed", {
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
      await updateMarketPricesFromBinance();
      await initializeBtcBenchmark();
      await updateBtcBenchmark();
    } catch (err) {
      logger.warn("autoRunner", "Benchmark init failed", { error: err?.message });
    }
    await loadAllModelAllowedSymbols();
    const symbols = getTrackedSymbols();
    if (symbols.length) {
      try {
        await importMarketData(symbols);
        logger.info("autoRunner", "Imported historical market data", {
          symbols: symbols.length,
        });
        marketLoopState.lastHistorySyncTs = Date.now();
      } catch (err) {
        logger.warn("autoRunner", "Initial market import failed", { error: err?.message });
      }
    }
    // 启动时强制一次风险/资金费同步
    try {
      const syncSymbols = getTrackedSymbols().map((s) => s.toUpperCase());
      if (syncSymbols.length) {
        await syncRiskAndFunding(syncSymbols);
        logger.info("autoRunner", "Initial risk/funding synced", {
          symbols: syncSymbols.length,
        });
      }
    } catch (err) {
      logger.warn("autoRunner", "Initial risk/funding sync failed", {
        error: err?.message,
      });
    }
  };
  marketLoopState.timer = setInterval(runMarketSyncCycle, MARKET_LOOP_INTERVAL_MS);
  bootstrap()
    .then(() => runMarketSyncCycle())
    .catch((error) => console.error("[autoRunner] initial market sync failed", error));
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
    // 步骤 1.5：每次 tick 优先尝试刷新市场价格与 BTC 基准线
    try {
      const updated = await updateMarketPricesFromBinance();
      logger.info("autoRunner", "Market prices updated", {
        symbols_updated: updated,
      });

      // 同步更新 BTC 基准模型的账户权益等数据
      const benchmark = await updateBtcBenchmark();
      if (benchmark) {
        logger.info("autoRunner", "BTC benchmark updated", {
          equity: benchmark.equity,
          return_percent:
            benchmark.returnPercent != null
              ? benchmark.returnPercent.toFixed(2) + "%"
              : undefined,
        });
      }
    } catch (priceError) {
      logger.warn("autoRunner", "Market price update failed", {
        error: priceError.message,
      });
      // 报价更新失败不影响后续策略模型的执行，仅记录日志
    }

    // 步骤 2：对所有模型做一次 mark-to-market，保证权益数据是最新的
    try {
      const mtmResult = await markToMarketAllModels();
      if (mtmResult?.updated?.length) {
        logger.info("autoRunner", "Mark-to-market applied", {
          models: mtmResult.updated,
          loop: "tick",
        });
      }
      if (mtmResult?.snapshots?.length) {
        logger.info("autoRunner", "Equity snapshots captured", {
          snapshot_count: mtmResult.snapshots.length,
          loop: "tick",
        });
      }
    } catch (mtmError) {
      logger.warn("autoRunner", "Mark-to-market failed", {
        error: mtmError.message,
      });
    }

    // 拉取所有 Agent 模型配置（包含密钥信息）
    const models = await listAgentModels({ includeSecrets: true });

    // 只保留开启了 auto_run 的模型
    const runnable = models.filter((model) => model.auto_run_enabled);

    // 当前时间戳（毫秒）
    const now = Date.now();

    // 步骤 3：依次遍历每一个可自动运行的模型
    for (const model of runnable) {
      // 该模型的自动轮询间隔（毫秒），默认 5 分钟
      const intervalMs = (model.auto_run_interval_minutes || 5) * 60 * 1000;

      // 取出上一次自动运行时间；从未运行过则视为 0
      const lastRun = model.last_auto_run_at
        ? new Date(model.last_auto_run_at).getTime()
        : 0;

      // 如果已经运行过，且距离上次运行未到达设定的间隔，则跳过本次
      // 预留 1000ms 的 buffer，避免边界时间导致的抖动问题
      if (lastRun && now - lastRun < intervalMs - 1000) {
        continue;
      }

      // 步骤 4：校验 API 证书（没有 key 的模型不能自动运行）
      if (!model.api_key) {
        logger.warn(
          "autoRunner",
          `Model ${model.model_id} is auto-run enabled but missing API key, skipping.`,
          { model_id: model.model_id },
        );
        continue;
      }

      // 步骤 5：对该模型执行一次完整的自动决策循环
      if (runningModels.has(model.model_id)) {
        logger.info("autoRunner", "Model already running, skipping duplicate run", {
          model_id: model.model_id,
        });
        continue;
      }

      runningModels.add(model.model_id);
      try {
        const startAt = Date.now();

        logger.info("autoRunner", `Model ${model.model_id} auto-run started`, {
          model_id: model.model_id,
          interval_minutes: model.auto_run_interval_minutes || 5,
          started_at: new Date(startAt).toISOString(),
        });

        // 执行一次决策周期：
        // 读取当前市场状况 -> 调用 LLM -> 解析决策 -> 下单 / 持仓调整 等
        const result = await runDecisionCycle(model.model_id, {
          source: "auto_cycle",
        });

        const elapsed = Date.now() - startAt;

        // 取出响应文本或对象，截取前 200 个字符用于日志预览，方便排查
        const responsePreview =
          typeof result?.response?.text === "string"
            ? result.response.text
            : JSON.stringify(result?.response ?? {});

        logger.info(
          "autoRunner",
          `Model ${model.model_id} auto-run finished`,
          {
            model_id: model.model_id,
            elapsed_ms: elapsed,
            response_preview: responsePreview.substring(0, 200),
            has_decisions: !!result?.decisions,
          },
        );
      } catch (err) {
        // 步骤 6：某个模型的自动运行失败，只记录错误日志，不影响其他模型
        logger.error(
          "autoRunner",
          `Model ${model.model_id} auto-run failed`,
          {
            model_id: model.model_id,
            error: err?.message,
            stack: err?.stack,
          },
        );
      } finally {
        runningModels.delete(model.model_id);
      }
    }
  } catch (error) {
    // 若出现意料之外的顶层异常（例如数据库不可用等），统一在此兜底
    console.error("[autoRunner] tick error", error);
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
    console.error("[autoRunner] initial tick failed", error),
  );
}
