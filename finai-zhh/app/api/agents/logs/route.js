import { getAgentLogs } from "../../../../lib/data/dataRepository";
import { requirePrincipal } from "../../../../lib/auth/requestAuth.js";

export async function GET(request) {
  const auth = await requirePrincipal(request, { allowGuest: true, requireWrite: false });
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 20);
  const beforeCreatedAt = url.searchParams.get("beforeCreatedAt");
  const beforeId = url.searchParams.get("beforeId");
  const logs = await getAgentLogs(limit, {
    ownerUserId: auth.principal.userId,
    beforeCreatedAt,
    beforeId,
  });
  const lastLog = logs.at(-1) ?? null;
  return Response.json({
    logs,
    hasMore: logs.length === limit,
    nextCursor: lastLog
      ? {
          beforeCreatedAt: lastLog.timestamp,
          beforeId: lastLog.id,
        }
      : null,
  });
}
