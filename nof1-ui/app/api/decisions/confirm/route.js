import {
  getPendingDecisionById,
  updatePendingDecisionStatus,
} from "../../../../lib/data/dataRepository";
import { applyDecisionSet } from "../../../../lib/trading/decisionExecutor";
import { ensureMarketSymbol } from "../../../../lib/market/symbols";

function normalizeDecisionInput(raw) {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    return raw.reduce((acc, entry) => {
      const sym =
        entry?.symbol ||
        entry?.coin ||
        entry?.asset ||
        entry?.ticker ||
        entry?.pair;
      const normalized = sym ? ensureMarketSymbol(sym).replace(/USDT$/i, "") : null;
      if (!normalized) {
        throw new Error("edited_decisions 缺少 symbol/coin 字段");
      }
      acc[normalized] = { ...entry, symbol: normalized };
      return acc;
    }, {});
  }
  if (typeof raw === "object") {
    return Object.entries(raw).reduce((acc, [key, value]) => {
      const normalized = ensureMarketSymbol(key).replace(/USDT$/i, "");
      acc[normalized] = { ...(value ?? {}), symbol: normalized };
      return acc;
    }, {});
  }
  throw new Error("edited_decisions 必须是对象或数组");
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
  const cycleId = pending.cycle_id ?? Math.floor(Date.now() / 1000);

  const promptText = pending.decision_blob?.prompt_text ?? null;
  const responseText = pending.decision_blob?.response_text ?? null;
  const responseJson = pending.decision_blob?.response_json ?? null;
  const reasoningContent = pending.reasoning_content ?? pending.decision_blob?.reasoning ?? null;

  if (action === "reject") {
    const updated = await updatePendingDecisionStatus(decisionId, "rejected", {
      public_message: "Human reviewer rejected pending decision.",
      cot_trace_summary: "Decision rejected.",
      reasoning_content: reasoningContent,
      response_json: responseJson,
      decision_blob: pending.decision_blob,
    });
    return Response.json({ ok: true, decision: updated });
  }

  let decisions = pending.decision_blob?.decisions ?? pending.decision_blob ?? {};
  if (payload?.edited_decisions) {
    decisions = normalizeDecisionInput(payload.edited_decisions);
  }
  const result = await applyDecisionSet(pending.model_id, decisions, {
    decisionSource: "ai_proposed_human_approved",
    cycleId,
  });

  const updated = await updatePendingDecisionStatus(decisionId, "approved", {
    public_message: "Human reviewer approved decision and positions were updated.",
    cot_trace_summary: `Approved ${result.executed} trades; risk ${result.totalRisk.toFixed(2)} USD.`,
    account_value_snapshot: result.account?.latest_equity ?? null,
    response_json: payload?.edited_decisions ?? responseJson,
    decision_blob: { ...(pending.decision_blob ?? {}), decisions },
    reasoning_content: reasoningContent,
  });

  return Response.json({
    ok: true,
    decision: updated,
    execution: result,
  });
}
