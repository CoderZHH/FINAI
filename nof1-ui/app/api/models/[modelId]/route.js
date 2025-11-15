import {
  deleteAgentModel,
  getAgentModelById,
  updateAgentModel,
} from "../../../../lib/dataRepository";
import { isModelRunning } from "../../../../lib/autoRunner";

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

    const currentModel = await getAgentModelById(modelId);
    if (!currentModel) {
      return Response.json({ error: "Model not found" }, { status: 404 });
    }
    if (isModelRunning(modelId)) {
      return Response.json(
        { error: "模型正在运行，暂时无法修改配置。" },
        { status: 409 }
      );
    }

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

    if (Object.prototype.hasOwnProperty.call(payload, "human_review_required")) {
      updates.human_review_required = Boolean(payload.human_review_required);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "prompt_template_id")) {
      if (payload.prompt_template_id === null) {
        updates.prompt_template_id = null;
      } else if (
        typeof payload.prompt_template_id === "string" &&
        payload.prompt_template_id.trim()
      ) {
        updates.prompt_template_id = payload.prompt_template_id.trim();
      } else {
        throw new Error("prompt_template_id must be null or a non-empty string.");
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, "auto_run_enabled")) {
      const desiredAutoRun = Boolean(payload.auto_run_enabled);
      const wasAutoRunEnabled = Boolean(currentModel.auto_run_enabled);
      updates.auto_run_enabled = desiredAutoRun;
      if (desiredAutoRun && !wasAutoRunEnabled) {
        updates.last_auto_run_at = null;
        updates.next_auto_run_at = null;
      }
      if (!desiredAutoRun) {
        updates.next_auto_run_at = null;
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, "display_icon")) {
      if (payload.display_icon === null) {
        updates.display_icon = null;
      } else if (typeof payload.display_icon === "string") {
        updates.display_icon = payload.display_icon;
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, "auto_run_interval_minutes")) {
      const interval = Number(payload.auto_run_interval_minutes);
      if (!Number.isFinite(interval) || interval < 1) {
        throw new Error("auto_run_interval_minutes must be a positive number.");
      }
      updates.auto_run_interval_minutes = Math.round(interval);
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
