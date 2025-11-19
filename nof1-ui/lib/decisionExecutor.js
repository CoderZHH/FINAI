import {
  appendAccountTimeseries,
  closeOpenTrades,
  getAgentModelById,
  getOpenPositions,
  getPriceMap,
  getRuntimeAccount,
  insertTrade,
  summarizeMarginAccount,
  upsertRuntimeAccount,
} from "./dataRepository.js";
import { logger } from "./logManager.js";
import { getFeeRate, getMarginModeForModel } from "./simConfig.js";
import { getIMR, getMMR, getMaxLeverage } from "./riskLimits.js";

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
  const modelConfig = (await getAgentModelById(modelId)) ?? { margin_config: {} };
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
  let walletBalance =
    account.wallet_balance ?? account.available_cash ?? startingEquity;
  let positionMargin = Number(account.position_margin ?? 0);
  const existingPositions = await getOpenPositions(modelId);
  const existingSummary = summarizeMarginAccount(walletBalance, existingPositions);
  let currentInitialMargin = existingSummary.totalInitialMargin;
  let marginBySymbol = { ...(existingSummary.marginBySymbol ?? {}) };
  if (!positionMargin) {
    positionMargin = currentInitialMargin;
  }
  logger.info("decisionExecutor.applyDecisionSet.start", {
    model_id: modelId,
    starting_equity: startingEquity,
    wallet_balance_before: walletBalance,
    position_margin_before: positionMargin,
    available_cash_before: account.available_cash,
    total_unrealized_pnl_before: account.total_unrealized_pnl,
    trade_count_before: account.trade_count,
    decisions_count: symbols.length,
  });

  const decisionSource = options.decisionSource ?? "ai_proposed_human_approved";
  const cycleId =
    options.cycleId != null && Number.isFinite(Number(options.cycleId))
      ? Number(options.cycleId)
      : null;
  const now = new Date();

  let executed = 0;
  let totalRisk = 0;
  let totalNotional = 0;
  let totalFees = 0;

  logger.info("decisionExecutor", "Applying decision set", {
    model_id: modelId,
    symbol_count: symbols.length,
    decision_source: decisionSource,
  });

  for (const [symbol, decision] of Object.entries(decisions)) {
    const ticker = prices[symbol];
    if (!ticker) continue;
    const marginMode = getMarginModeForModel(modelConfig, symbol);

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

    logger.info("decisionExecutor.decision.before", {
      model_id: modelId,
      symbol,
      raw_signal: decision.signal,
      normalized_signal: signal,
      price,
      quantity,
      leverage_requested: leverage,
      risk_usd: riskBudget,
      wallet_balance_before: walletBalance,
      position_margin_before: positionMargin,
    });
    // 如果是 hold 信号，跳过此币种（保持现有仓位不变）
    if (signal === 'hold') {
      continue;
    }

    // 如果是 close 信号或数量为0，删除持仓（平仓）
    if (signal === "close" || quantity <= 0) {
      const closeResult = await closeOpenTrades(modelId, symbol, price);
      if (closeResult.closed > 0) {
        walletBalance += closeResult.realizedPnl;
        if (closeResult.feesPaid) {
          walletBalance = Math.max(0, walletBalance - closeResult.feesPaid);
          totalFees += closeResult.feesPaid;
        }
        const symbolKey = String(symbol ?? "").toUpperCase();
        const released = closeResult.releasedMargin ?? 0;
        walletBalance += released;
        if (marginMode === "isolated") {
          marginBySymbol[symbolKey] = Math.max(
            0,
            (marginBySymbol[symbolKey] ?? 0) - released
          );
        } else {
          positionMargin = Math.max(0, positionMargin - released);
        }
        currentInitialMargin = Math.max(0, currentInitialMargin - released);
        executed += closeResult.closed;
        logger.info("decisionExecutor", "Closed open positions", {
          model_id: modelId,
          symbol,
          closed_count: closeResult.closed,
          realized_pnl: closeResult.realizedPnl,
        });
        logger.info("decisionExecutor.decision.closeResult", {
          model_id: modelId,
          symbol,
          closed: closeResult.closed,
          realized_pnl: closeResult.realizedPnl,
          fees_paid: closeResult.feesPaid,
          released_margin: closeResult.releasedMargin,
          wallet_balance_after_close: walletBalance,
          position_margin_after_close: positionMargin,
        });
      }
      continue;
    }

    const side = signal === "short" ? "SHORT" : "LONG";
    const requestedLeverage = Number.isFinite(leverage) && leverage > 0 ? leverage : 1;
    const baseNotional = Math.abs(price * quantity);
    if (!Number.isFinite(baseNotional) || baseNotional <= 0) {
      logger.warn("decisionExecutor", "Skipped trade due to invalid notional", {
        model_id: modelId,
        symbol,
        price,
        quantity,
      });
      continue;
    }
    const imr = (await getIMR(symbol, baseNotional)) ?? 0;
    const mmr = (await getMMR(symbol, baseNotional)) ?? 0;
    const maxLev = (await getMaxLeverage(symbol, baseNotional)) ?? requestedLeverage;
    const leverageValue = Math.min(
      requestedLeverage,
      maxLev > 0 ? maxLev : 1
    );
    const marginRequired = baseNotional / leverageValue;
    const initialMargin = baseNotional * imr;
    const symbolKey = String(symbol ?? "").toUpperCase();
    const lockedForSymbol =
      marginMode === "isolated"
        ? marginBySymbol[symbolKey] ?? 0
        : positionMargin;
    const availableBalanceBefore = walletBalance - lockedForSymbol;
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
      leverage: leverageValue,
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
    totalNotional += baseNotional;
    currentInitialMargin += initialMargin;
    if (marginMode === "isolated") {
      marginBySymbol[symbolKey] = (marginBySymbol[symbolKey] ?? 0) + initialMargin;
    } else {
      walletBalance = Math.max(0, walletBalance - initialMargin);
      positionMargin += initialMargin;
    }

    const takerFeeRate = getFeeRate(symbol, "taker");
    const takerFee = baseNotional * takerFeeRate;
    if (takerFee > 0) {
      walletBalance = Math.max(0, walletBalance - takerFee);
      totalFees += takerFee;
    }
    logger.info("decisionExecutor.decision.open", {
      model_id: modelId,
      symbol,
      side,
      price,
      quantity,
      leverage_effective: leverageValue,
      base_notional: baseNotional,
      margin_mode: marginMode,
      initial_margin: initialMargin,
      taker_fee: takerFee,
      wallet_balance_after_open: walletBalance,
      position_margin_after_open: positionMargin,
      total_notional_accumulated: totalNotional,
    });
  }

  const openPositions = await getOpenPositions(modelId);
  const summary = summarizeMarginAccount(walletBalance, openPositions);
  positionMargin = summary.totalInitialMargin;
  const latestEquity = walletBalance + summary.totalUnrealized;
  const availableCash = walletBalance - positionMargin;
  const realizedPnl = walletBalance - startingEquity;

  logger.info("decisionExecutor.applyDecisionSet.beforeUpsert", {
    model_id: modelId,
    wallet_balance_before_upsert: walletBalance,
    position_margin_before_upsert: positionMargin,
    summary_equity: summary.equity,
    summary_unrealized: summary.totalUnrealized,
    available_cash_computed: availableCash,
    realized_pnl_computed: realizedPnl,
    executed_trades: executed,
    total_risk_usd: totalRisk,
    total_notional_usd: totalNotional,
    total_fees_usd: totalFees,
  });

  const updatedAccount = await upsertRuntimeAccount(modelId, {
    starting_equity: startingEquity,
    latest_equity: latestEquity,
    available_cash: availableCash,
    total_unrealized_pnl: summary.totalUnrealized,
    sharpe_ratio: account.sharpe_ratio ?? 0,
    win_rate: account.win_rate ?? 0,
    trade_count: (account.trade_count ?? 0) + executed,
    wallet_balance: walletBalance,
    position_margin: positionMargin,
  });
  logger.info("decisionExecutor.applyDecisionSet.afterUpsert", {
    model_id: modelId,
    db_latest_equity: updatedAccount?.latest_equity,
    db_available_cash: updatedAccount?.available_cash,
    db_wallet_balance: updatedAccount?.wallet_balance,
    db_position_margin: updatedAccount?.position_margin,
    db_total_unrealized_pnl: updatedAccount?.total_unrealized_pnl,
  });

  // ✅ 记录到时间序列表（用于图表绘制）
  await appendAccountTimeseries({
    modelId,
    ts: now,
    equity: summary.equity,
    cash_available: availableCash,
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
    fees_paid_usd: Number(totalFees.toFixed(6)),
  });

  return {
    executed,
    totalRisk,
    totalNotional,
    account: updatedAccount ?? {
      ...account,
      latest_equity: latestEquity,
      available_cash: availableCash,
      total_unrealized_pnl: summary.totalUnrealized,
    },
  };
}
