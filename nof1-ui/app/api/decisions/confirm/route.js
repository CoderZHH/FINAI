import {
  getPendingDecisionById,
  insertAgentLog,
  updatePendingDecisionStatus,
} from "../../../../lib/dataRepository";
import { applyDecisionSet } from "../../../../lib/decisionExecutor";

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
      reasoning_content: reasoningContent,
      response_json: responseJson,
      decision_blob: pending.decision_blob,
    });
    await insertAgentLog(
      pending.model_id,
      "Human reviewer rejected pending decision.",
      "Decision rejected.",
      {
        prompt_text: promptText,
        response_text: responseText,
        response_json: responseJson,
        cycle_id: cycleId,
        reasoning_content: reasoningContent,
      }
    );
    return Response.json({ ok: true, decision: updated });
  }

  const decisions = pending.decision_blob?.decisions ?? pending.decision_blob ?? {};
  const result = await applyDecisionSet(pending.model_id, decisions, {
    decisionSource: "ai_proposed_human_approved",
    cycleId,
  });

  const updated = await updatePendingDecisionStatus(decisionId, "approved", {
    public_message: "Human reviewer approved decision and positions were updated.",
    cot_trace_summary: `Approved ${result.executed} trades; risk ${result.totalRisk.toFixed(2)} USD.`,
    account_value_snapshot: result.account?.latest_equity ?? null,
    response_json: responseJson,
    decision_blob: pending.decision_blob,
    reasoning_content: reasoningContent,
  });
  await insertAgentLog(
    pending.model_id,
    "Human reviewer approved decision and positions were updated.",
    `Approved ${result.executed} trades; risk ${result.totalRisk.toFixed(2)} USD.`,
        {
          prompt_text: promptText,
          response_text: responseText,
          response_json: responseJson,
          cycle_id: cycleId,
          reasoning_content: reasoningContent,
        }
      );

  return Response.json({
    ok: true,
    decision: updated,
    execution: result,
  });
}
