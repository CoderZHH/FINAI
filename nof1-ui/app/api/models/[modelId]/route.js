import {
  deleteAgentModel,
  getAgentModelById,
  updateAgentModel,
} from "../../../../lib/dataRepository";

async function getModelIdFromContext(context) {
  if (!context) return undefined;
  if ("params" in context) {
    const params = await context.params;
    return params?.modelId;
  }
  return undefined;
}

export async function GET(_request, context) {
  const modelId = await getModelIdFromContext(context);
  const model = await getAgentModelById(modelId);
  if (!model) {
    return Response.json({ error: "Model not found" }, { status: 404 });
  }
  return Response.json({ model });
}

export async function PUT(request, context) {
  const modelId = await getModelIdFromContext(context);
  try {
    console.log("[api/models] PUT", modelId);
    const payload = await request.json();
    console.log("[api/models] payload", payload);

    const updates = {};

    if (Object.prototype.hasOwnProperty.call(payload, "display_name")) {
      const displayName =
        typeof payload.display_name === "string"
          ? payload.display_name.trim()
          : "";
      if (!displayName) {
        throw new Error("display_name cannot be empty.");
      }
      updates.display_name = displayName;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "api_base_url")) {
      updates.api_base_url =
        typeof payload.api_base_url === "string"
          ? payload.api_base_url.trim() || null
          : null;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "api_key")) {
      if (payload.api_key === null) {
        updates.api_key = null;
      } else {
        updates.api_key =
          typeof payload.api_key === "string"
            ? payload.api_key.trim() || null
            : null;
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, "system_prompt")) {
      updates.system_prompt =
        typeof payload.system_prompt === "string"
          ? payload.system_prompt
          : "";
    }

    if (Object.prototype.hasOwnProperty.call(payload, "user_prompt")) {
      updates.user_prompt =
        typeof payload.user_prompt === "string"
          ? payload.user_prompt
          : "";
    }

    if (Object.prototype.hasOwnProperty.call(payload, "human_review_required")) {
      updates.human_review_required = Boolean(payload.human_review_required);
    }

    const model = await updateAgentModel(modelId, updates);
    console.log("[api/models] update result", model);
    if (!model) {
      return Response.json({ error: "Model not found" }, { status: 404 });
    }
    return Response.json({ model });
  } catch (err) {
    console.error(`[PUT /api/models/${modelId}] failed`, err);
    const message =
      err instanceof Error ? err.message : "Failed to update model";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request, context) {
  const modelId = await getModelIdFromContext(context);
  await deleteAgentModel(modelId);
  return Response.json({ ok: true });
}
