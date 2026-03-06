import { logger } from "@/lib/infrastructure/logManager";
import {
  createPromptTemplate,
  listPromptTemplates,
} from "../../../lib/data/dataRepository";
import { requirePrincipal } from "../../../lib/auth/requestAuth.js";

export async function GET(request) {
  const auth = await requirePrincipal(request, { allowGuest: true, requireWrite: false });
  if (!auth.ok) return auth.response;
  const principal = auth.principal;
  const url = new URL(request.url);
  const includeContent = url.searchParams.get("includeContent") !== "false";
  const templates = await listPromptTemplates({
    includeContent,
    ownerUserId: principal.userId,
  });
  return Response.json({ templates });
}

export async function POST(request) {
  const auth = await requirePrincipal(request, { allowGuest: true, requireWrite: true });
  if (!auth.ok) return auth.response;
  const principal = auth.principal;
  try {
    const payload = await request.json();
    const template = await createPromptTemplate({
      template_name: payload?.template_name,
      description: payload?.description ?? "",
      system_prompt: typeof payload?.system_prompt === "string" ? payload.system_prompt : "",
      user_prompt: typeof payload?.user_prompt === "string" ? payload.user_prompt : "",
      placeholder_tokens: Array.isArray(payload?.placeholder_tokens)
        ? payload.placeholder_tokens
        : undefined,
      sample_market_state_text:
        typeof payload?.sample_market_state_text === "string"
          ? payload.sample_market_state_text
          : "",
      sample_position_state_text:
        typeof payload?.sample_position_state_text === "string"
          ? payload.sample_position_state_text
          : "",
      is_default: Boolean(payload?.is_default),
    }, {
      ownerUserId: principal.userId,
    });
    return Response.json({ template });
  } catch (error) {
    logger.error("api:prompt-templates", "创建模板失败", {
      error: error?.message,
    });
    const message = error instanceof Error ? error.message : "Failed to create template";
    return Response.json({ error: message }, { status: 400 });
  }
}
