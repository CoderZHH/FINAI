import { logger } from "@/lib/infrastructure/logManager";
import {
  deletePromptTemplate,
  getPromptTemplateById,
  updatePromptTemplate,
} from "../../../../lib/data/dataRepository";

async function getTemplateId(context) {
  if (!context) return undefined;
  if ("params" in context) {
    const params = await context.params;
    return params?.templateId;
  }
  return undefined;
}

export async function GET(_request, context) {
  const templateId = await getTemplateId(context);
  const template = await getPromptTemplateById(templateId);
  if (!template) {
    return Response.json({ error: "Template not found" }, { status: 404 });
  }
  return Response.json({ template });
}

export async function PUT(request, context) {
  const templateId = await getTemplateId(context);
  if (!templateId) {
    return Response.json({ error: "templateId is required" }, { status: 400 });
  }
  try {
    const payload = await request.json();
    const template = await updatePromptTemplate(templateId, payload ?? {});
    return Response.json({ template });
  } catch (error) {
    logger.error("api:prompt-templates", "更新模板失败", {
      template_id: templateId,
      error: error?.message,
    });
    const message = error instanceof Error ? error.message : "Failed to update template";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request, context) {
  const templateId = await getTemplateId(context);
  if (!templateId) {
    return Response.json({ error: "templateId is required" }, { status: 400 });
  }
  try {
    await deletePromptTemplate(templateId);
    return Response.json({ ok: true });
  } catch (error) {
    logger.error("api:prompt-templates", "删除模板失败", {
      template_id: templateId,
      error: error?.message,
    });
    const message = error instanceof Error ? error.message : "Failed to delete template";
    return Response.json({ error: message }, { status: 400 });
  }
}
