import {
  getPendingDecisionById,
  getPriceMap,
  getRuntimeAccount,
  upsertRuntimeAccount,
  upsertRuntimePosition,
  deleteRuntimePosition,
  insertTrade,
  insertAgentLog,
  updatePendingDecisionStatus,
} from "../../../../lib/dataRepository";

function ensureUsdtSymbol(symbol) {
  if (!symbol) return symbol;
  const upper = symbol.toUpperCase();
  if (upper.endsWith("USDT")) return upper;
  return `${upper}USDT`;
}

function normaliseDecisions(decisions) {
  const normalized = {};
  Object.entries(decisions ?? {}).forEach(([symbol, value]) => {
    normalized[ensureUsdtSymbol(symbol)] = value;
  });
  return normalized;
}

function buildExitPlan(decision) {
  return {
    profit_target: decision.profit_target ?? null,
    stop_loss: decision.stop_loss ?? null,
    invalidation_condition: decision.invalidation_condition ?? null,
    confidence: decision.confidence ?? null,
    risk_usd: decision.risk_usd ?? null,
  };
}
}

async function applyApprovedDecision(modelId, decisions) {
  const symbols = Object.keys(decisions);
  if (!symbols.length) return { executed: 0, totalRisk: 0, totalNotional: 0 };

  const prices = await getPriceMap(symbols);
  const account = (await getRuntimeAccount(modelId)) ?? {
    starting_equity: 10000,
    latest_equity: 10000,
    available_cash: 10000,
    total_unrealized_pnl: 0,
    trade_count: 0,
    sharpe_ratio: 0,
    win_rate: 0,
  };
  let executed = 0;
  let totalRisk = 0;
  let totalNotional = 0;

  for (const [symbol, decision] of Object.entries(decisions)) {
    const ticker = prices[symbol];
    if (!ticker) continue;

    const price = Number(ticker.price ?? 0);
    const signal = String(decision.signal || "flat").toLowerCase();
    const quantity = Number(decision.quantity ?? 0);
    const leverage = Number(decision.leverage ?? 1);
    const riskBudget = Number(decision.risk_usd ?? price * quantity);

    if (signal === "flat" || quantity <= 0) {
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
      entry_time: new Date(),
      exit_time: null,
      holding_time: null,
      realized_net_pnl: 0,
      decision_source: "ai_proposed_human_approved",
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

  await upsertRuntimeAccount(modelId, {
    starting_equity: startingEquity,
    latest_equity: latestEquity,
    available_cash: availableCash,
    total_unrealized_pnl: 0,
    sharpe_ratio: account.sharpe_ratio ?? 0,
    win_rate: account.win_rate ?? 0,
    trade_count: (account.trade_count ?? 0) + executed,
  });

  return { executed, totalRisk, totalNotional };
}

export async function POST(request) {
  const payload = await request.json();
  const decisionId = payload?.decision_id;
  const action = String(payload?.action ?? "").toLowerCase();

  if (!decisionId || !["approve", "reject"].includes(action)) {
    return Response.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const pending = await getPendingDecisionById(decisionId);
  if (!pending) {
    return Response.json({ ok: false, error: "Decision not found" }, { status: 404 });
  }

  const promptText = pending.decision_blob?.prompt_text ?? null;
  const responseText = pending.decision_blob?.response_text ?? null;
  const responseJson = pending.decision_blob?.response_json ?? null;

  if (action === "reject") {
    const updated = await updatePendingDecisionStatus(decisionId, "rejected");
    await insertAgentLog(
      pending.model_id,
      "Human reviewer rejected pending decision.",
      "Decision rejected.",
      {
        prompt_text: promptText,
        response_text: responseText,
        response_json: responseJson,
      }
    );
    return Response.json({ ok: true, decision: updated });
  }

  const decisionsRaw = pending.decision_blob?.decisions ?? pending.decision_blob ?? {};
  const decisions = normaliseDecisions(decisionsRaw);
  const result = await applyApprovedDecision(pending.model_id, decisions);

  const updated = await updatePendingDecisionStatus(decisionId, "approved");
  await insertAgentLog(
    pending.model_id,
    "Human reviewer approved decision and positions were updated.",
    `Approved ${result.executed} trades; risk ${result.totalRisk.toFixed(2)} USD.`,
    {
      prompt_text: promptText,
      response_text: responseText,
      response_json: responseJson,
    }
  );

  return Response.json({
    ok: true,
    decision: updated,
    execution: result,
  });
}
