import { randomUUID } from "node:crypto";
import { createAgentModel, listAgentModels } from "../../../lib/dataRepository";
import { ensureAutoRunner } from "../../../lib/autoRunner";

ensureAutoRunner();

function slugifyDisplayName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function generateModelId(displayName) {
  const slug = slugifyDisplayName(displayName);
  if (slug) {
    return `${slug}-${randomUUID().slice(0, 6)}`;
  }
  return `model-${randomUUID().slice(0, 8)}`;
}

export async function GET(request) {
  const url = new URL(request.url);
  const includeSecrets = url.searchParams.get("includeSecrets") === "true";
  const includeDisabled = url.searchParams.get("includeDisabled") !== "false";

  const models = await listAgentModels({
    includeDisabled,
    includeSecrets,
  });

  return Response.json({ models });
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const rawDisplayName =
      typeof payload?.display_name === "string" ? payload.display_name.trim() : "";
    if (!rawDisplayName) {
      return Response.json({ error: "display_name is required." }, { status: 400 });
    }
    const modelId = generateModelId(rawDisplayName);

    const cleanPayload = {
      model_id: modelId,
      display_name: rawDisplayName,
      api_base_url:
        typeof payload.api_base_url === "string"
          ? payload.api_base_url.trim() || null
          : null,
      api_key:
        typeof payload.api_key === "string"
          ? payload.api_key.trim() || null
          : null,
      human_review_required: Boolean(payload.human_review_required),
      prompt_template_id:
        typeof payload.prompt_template_id === "string" && payload.prompt_template_id.trim()
          ? payload.prompt_template_id.trim()
          : null,
      auto_run_enabled: Boolean(payload.auto_run_enabled),
      auto_run_interval_minutes:
        typeof payload.auto_run_interval_minutes === "number"
          ? payload.auto_run_interval_minutes
          : Number(payload.auto_run_interval_minutes) || 5,
      display_icon:
        typeof payload.display_icon === "string" ? payload.display_icon : undefined,
    };

    const model = await createAgentModel(cleanPayload);
    return Response.json({ model });
  } catch (err) {
    console.error("[POST /api/models] failed", err);
    const message =
      err instanceof Error ? err.message : "Failed to create model";
    return Response.json({ error: message }, { status: 400 });
  }
}
