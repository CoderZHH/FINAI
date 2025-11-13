import {
  deleteRuntimePosition,
  getPriceMap,
  getRuntimeAccount,
  insertTrade,
  upsertRuntimeAccount,
  upsertRuntimePosition,
  appendAccountTimeseries, // ✅ 添加时间序列记录函数
} from "./dataRepository.js";

export function normaliseDecisionMap(decisions) {
  return { ...(decisions ?? {}) };
}

;
  Object.entries(decisions ?? {}).forEach(([symbol, value]) => {
    normalized[ensureUsdtSymbol(symbol)] = value;
  });
  return normalized;
}

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

  const decisionSource = options.decisionSource ?? "ai_proposed_human_approved";
  const now = new Date();

  let executed = 0;
  let totalRisk = 0;
  let totalNotional = 0;

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
      await deleteRuntimePosition(modelId, symbol);
      continue;
    }

    const side = signal === "short" ? "SHORT" : "LONG";
    const notional = price * quantity * leverage;

    await upsertRuntimePosition(modelId, {
      symbol,
      side,
      leverage,
      entry_price: price,
      current_price: price,
      quantity,
      notional,
      unrealized_pnl: 0,
      take_profit: decision.profit_target ?? null,
      stop_loss: decision.stop_loss ?? null,
      exit_plan: buildExitPlan(decision),
    });

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
      exit_plan: buildExitPlan(decision),
    });

    executed += 1;
    totalRisk += Math.max(0, riskBudget);
    totalNotional += notional;
  }

  const startingEquity = account.starting_equity ?? 10000;
  const previousCash = account.available_cash ?? startingEquity;
  const availableCash = Math.max(0, previousCash - totalRisk);
  const latestEquity = availableCash + totalNotional;

  const updatedAccount = await upsertRuntimeAccount(modelId, {
    starting_equity: startingEquity,
    latest_equity: latestEquity,
    available_cash: availableCash,
    total_unrealized_pnl: 0,
    sharpe_ratio: account.sharpe_ratio ?? 0,
    win_rate: account.win_rate ?? 0,
    trade_count: (account.trade_count ?? 0) + executed,
  });

  // ✅ 记录到时间序列表（用于图表绘制）
  await appendAccountTimeseries({
    modelId,
    ts: now,
    equity: latestEquity,
    cash_available: availableCash,
    unrealized_pnl: 0,
    realized_pnl: account.total_realized_pnl ?? 0,
    sharpe: account.sharpe_ratio ?? 0,
    win_rate: account.win_rate ?? 0,
  });

  return {
    executed,
    totalRisk,
    totalNotional,
    account: updatedAccount ?? {
      ...account,
      latest_equity: latestEquity,
      available_cash: availableCash,
    },
  };
}
