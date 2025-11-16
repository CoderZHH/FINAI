import {
  appendAccountTimeseries,
  closeOpenTrades,
  getOpenPositions,
  getPriceMap,
  getRuntimeAccount,
  insertTrade,
  summarizeMarginAccount,
  upsertRuntimeAccount,
} from "./dataRepository.js";
import { logger } from "./logManager.js";

export function buildExitPlan(decision = {}) {
  return {
    profit_target: decision.profit_target ?? null,
    stop_loss: decision.stop_loss ?? null,
    invalidation_condition: decision.invalidation_condition ?? null,
    confidence: decision.confidence ?? null,
    risk_usd: decision.risk_usd ?? null,
  };
}

export async function applyDecisionSet(modelId, decisions, options = {}) {
  const symbols = Object.keys(decisions ?? {});
  if (!symbols.length) {
    return {
      executed: 0,
      totalRisk: 0,
      totalNotional: 0,
      account: null,
    };
  }

  const prices = await getPriceMap(symbols);
  const account =
    (await getRuntimeAccount(modelId)) ?? {
      starting_equity: 10000,
      latest_equity: 10000,
      available_cash: 10000,
      total_unrealized_pnl: 0,
      trade_count: 0,
      sharpe_ratio: 0,
      win_rate: 0,
    };
  const startingEquity = account.starting_equity ?? 10000;
  let walletBalance = account.available_cash ?? startingEquity;
  const existingPositions = await getOpenPositions(modelId);
  let { totalInitialMargin: currentInitialMargin } = summarizeMarginAccount(
    walletBalance,
    existingPositions
  );

  const decisionSource = options.decisionSource ?? "ai_proposed_human_approved";
  const cycleId =
    options.cycleId != null && Number.isFinite(Number(options.cycleId))
      ? Number(options.cycleId)
      : null;
  const now = new Date();

  let executed = 0;
  let totalRisk = 0;
  let totalNotional = 0;

  logger.info("decisionExecutor", "Applying decision set", {
    model_id: modelId,
    symbol_count: symbols.length,
    decision_source: decisionSource,
  });

  for (const [symbol, decision] of Object.entries(decisions)) {
    const ticker = prices[symbol];
    if (!ticker) continue;

    const price = Number(ticker.price ?? 0);
    let rawSignal = String(decision.signal || "hold").toLowerCase();
    const quantity = Number(decision.quantity ?? 0);
    const leverage = Number(decision.leverage ?? 1);
    const riskBudget = Number(decision.risk_usd ?? price * quantity);

    // 📊 信号名称映射：将各种格式统一为 long/short/hold/close
    const signalMap = {
      'buy': 'long',
      'buy_to_enter': 'long',
      'long': 'long',
      'sell': 'short',
      'sell_to_enter': 'short',
      'short': 'short',
      'hold': 'hold',        // ✅ hold = 保持现有仓位，不做任何操作
      'flat': 'close',       // ✅ flat = 平仓
      'close': 'close',      // ✅ close = 平仓
      'exit': 'close'        // ✅ exit = 平仓
    };
    
    const signal = signalMap[rawSignal] || 'hold';

    // 如果是 hold 信号，跳过此币种（保持现有仓位不变）
    if (signal === 'hold') {
      continue;
    }

    // 如果是 close 信号或数量为0，删除持仓（平仓）
    if (signal === "close" || quantity <= 0) {
      const closeResult = await closeOpenTrades(modelId, symbol, price);
      if (closeResult.closed > 0) {
        walletBalance += closeResult.realizedPnl;
        currentInitialMargin = Math.max(
          0,
          currentInitialMargin - (closeResult.releasedMargin ?? 0)
        );
        executed += closeResult.closed;
        logger.info("decisionExecutor", "Closed open positions", {
          model_id: modelId,
          symbol,
          closed_count: closeResult.closed,
          realized_pnl: closeResult.realizedPnl,
        });
      }
      continue;
    }

    const side = signal === "short" ? "SHORT" : "LONG";
    const leverageValue = Number.isFinite(leverage) && leverage > 0 ? leverage : 1;
    const baseNotional = price * quantity;
    if (!Number.isFinite(baseNotional) || baseNotional <= 0) {
      logger.warn("decisionExecutor", "Skipped trade due to invalid notional", {
        model_id: modelId,
        symbol,
        price,
        quantity,
      });
      continue;
    }
    const marginRequired = baseNotional / leverageValue;
    const availableBalanceBefore = walletBalance - currentInitialMargin;
    if (availableBalanceBefore < marginRequired) {
      logger.warn("decisionExecutor", "Insufficient available balance for margin", {
        model_id: modelId,
        symbol,
        available_balance: availableBalanceBefore,
        margin_required: marginRequired,
      });
      continue;
    }

    await insertTrade({
      model_id: modelId,
      symbol,
      side,
      leverage,
      quantity,
      entry_price: price,
      exit_price: null,
      entry_time: now,
      exit_time: null,
      holding_time: null,
      realized_net_pnl: 0,
      decision_source: decisionSource,
      cycle_id: cycleId,
      exit_plan: buildExitPlan(decision),
    });

    executed += 1;
    totalRisk += Math.max(0, riskBudget);
    totalNotional += baseNotional * leverageValue;
    currentInitialMargin += marginRequired;
  }

  const openPositions = await getOpenPositions(modelId);
  const summary = summarizeMarginAccount(walletBalance, openPositions);
  const realizedPnl = walletBalance - startingEquity;

  const updatedAccount = await upsertRuntimeAccount(modelId, {
    starting_equity: startingEquity,
    latest_equity: summary.equity,
    available_cash: summary.walletBalance,
    total_unrealized_pnl: summary.totalUnrealized,
    sharpe_ratio: account.sharpe_ratio ?? 0,
    win_rate: account.win_rate ?? 0,
    trade_count: (account.trade_count ?? 0) + executed,
  });

  // ✅ 记录到时间序列表（用于图表绘制）
  await appendAccountTimeseries({
    modelId,
    ts: now,
    equity: summary.equity,
    cash_available: summary.availableBalance,
    unrealized_pnl: summary.totalUnrealized,
    realized_pnl: realizedPnl,
    sharpe: account.sharpe_ratio ?? 0,
    win_rate: account.win_rate ?? 0,
  });

  logger.info("decisionExecutor", "Decision set applied", {
    model_id: modelId,
    executed_trades: executed,
    total_risk_usd: Number(totalRisk.toFixed(2)),
    total_notional_usd: Number(totalNotional.toFixed(2)),
    latest_equity: summary.equity,
  });

  return {
    executed,
    totalRisk,
    totalNotional,
    account: updatedAccount ?? {
      ...account,
      latest_equity: summary.equity,
      available_cash: summary.walletBalance,
      total_unrealized_pnl: summary.totalUnrealized,
    },
  };
}
