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
} from "../data/dataRepository.js";
import { logger, logCalcEvent } from "../infrastructure/logManager.js";
import { getFeeRate, getMarginModeForModel } from "../data/simConfig.js";
import { getTrackedSymbols } from "../data/dataRepository.js";
import { getIMR, getMMR, getMaxLeverage } from "../data/riskLimits.js";

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
  let walletBalance = Math.max(
    0,
    account.wallet_balance ?? account.available_cash ?? startingEquity
  );
  let positionMargin = Number(account.position_margin ?? 0);
  const existingPositions = await getOpenPositions(modelId);
  const existingSummary = summarizeMarginAccount(walletBalance, existingPositions);
  let currentInitialMargin = existingSummary.totalInitialMargin;
  let marginBySymbol = { ...(existingSummary.marginBySymbol ?? {}) };
  if (!positionMargin) {
    positionMargin = currentInitialMargin;
  }
  logCalcEvent("decisionExecutor", "applyDecisionSet.start", {
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
  const configuredSymbols = getTrackedSymbols().map((s) =>
    String(s ?? "").trim().toUpperCase().replace(/USDT$/i, "")
  );
  const modelAllowed = Array.isArray(modelConfig?.allowed_symbols)
    ? modelConfig.allowed_symbols.map((s) =>
        String(s ?? "").trim().toUpperCase().replace(/USDT$/i, "")
      )
    : [];
  const allowList = modelAllowed.length ? modelAllowed : [];
  const allowedSymbols = new Set(allowList);

  logCalcEvent("decisionExecutor", "decisionSet.begin", {
    model_id: modelId,
    symbol_count: symbols.length,
    decision_source: decisionSource,
  });

  for (const [symbol, decision] of Object.entries(decisions)) {
    const ticker = prices[symbol];
    if (!ticker) continue;
    const normalizedBase = String(symbol ?? "")
      .trim()
      .toUpperCase()
      .replace(/USDT$/i, "");
    if (!allowedSymbols.has(normalizedBase)) {
      logCalcEvent("decisionExecutor", "decision.blockedSymbol", {
        model_id: modelId,
        symbol,
        reason: "symbol_not_in_tradable_list",
      });
      continue;
    }
    const marginMode = getMarginModeForModel(modelConfig, symbol);

    const price = Number(ticker.price ?? 0);
    let rawSignal = String(decision.signal || "hold").toLowerCase();
    const quantity = Number(decision.quantity ?? 0);
    const leverage = Number(decision.leverage ?? 1);
    const riskBudget = Number(decision.risk_usd ?? price * quantity);

    const signalMap = {
      'buy': 'long',
      'buy_to_enter': 'long',
      'long': 'long',
      'sell': 'short',
      'sell_to_enter': 'short',
      'short': 'short',
      'hold': 'hold',
      'flat': 'close',
      'close': 'close',
      'exit': 'close'
    };
    
    const signal = signalMap[rawSignal] || 'hold';

    logCalcEvent("decisionExecutor", "decision.before", {
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
        totalFees += closeResult.feesPaid ?? 0;
        const symbolKey = String(symbol ?? "").toUpperCase();
        const released = closeResult.releasedMargin ?? 0;
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
        logCalcEvent("decisionExecutor", "close.completed", {
          model_id: modelId,
          symbol,
          closed_count: closeResult.closed,
          realized_pnl: closeResult.realizedPnl,
        });
        logCalcEvent("decisionExecutor", "close.snapshot", {
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
      logger.warn("decisionExecutor", "无效名义金额，跳过开仓", {
        model_id: modelId,
        symbol,
        price,
        quantity,
      });
      continue;
    }
    const imr = await getIMR(symbol, baseNotional);
    const mmr = await getMMR(symbol, baseNotional);
    const maxLev = (await getMaxLeverage(symbol, baseNotional)) ?? requestedLeverage;
    const leverageValue = Math.min(
      requestedLeverage,
      maxLev > 0 ? maxLev : 1
    );
    const initialMargin =
      imr != null
        ? baseNotional * imr
        : baseNotional / Math.max(1, leverageValue);
    const marginRequired = initialMargin;
    const symbolKey = String(symbol ?? "").toUpperCase();
    const lockedForSymbol =
      marginMode === "isolated"
        ? marginBySymbol[symbolKey] ?? 0
        : positionMargin;
    const availableBalanceBefore = walletBalance - lockedForSymbol;
    if (availableBalanceBefore < marginRequired) {
      logger.warn("decisionExecutor", "可用保证金不足，跳过开仓", {
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
      notional_usd: baseNotional,
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
      positionMargin += initialMargin;
    }

    const takerFeeRate = getFeeRate(symbol, "taker");
    const takerFee = baseNotional * takerFeeRate;
    if (takerFee > 0) {
      walletBalance = Math.max(0, walletBalance - takerFee);
      totalFees += takerFee;
    }
    logCalcEvent("decisionExecutor", "open.snapshot", {
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

  logCalcEvent("decisionExecutor", "persist.beforeUpsert", {
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
  logCalcEvent("decisionExecutor", "persist.afterUpsert", {
    model_id: modelId,
    db_latest_equity: updatedAccount?.latest_equity,
    db_available_cash: updatedAccount?.available_cash,
    db_wallet_balance: updatedAccount?.wallet_balance,
    db_position_margin: updatedAccount?.position_margin,
    db_total_unrealized_pnl: updatedAccount?.total_unrealized_pnl,
  });

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

  logCalcEvent("decisionExecutor", "decisionSet.done", {
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
