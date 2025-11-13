import {
  getPendingDecisionById,
  insertAgentLog,
  updatePendingDecisionStatus,
} from "../../../../lib/dataRepository";
import {
  applyDecisionSet,
  normaliseDecisionMap,
} from "../../../../lib/decisionExecutor";

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
  const decisions = normaliseDecisionMap(decisionsRaw);
  const result = await applyDecisionSet(pending.model_id, decisions, {
    decisionSource: "ai_proposed_human_approved",
  });

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
