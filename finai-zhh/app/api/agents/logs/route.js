import { getAgentLogs } from "../../../../lib/data/dataRepository";
import { requirePrincipal } from "../../../../lib/auth/requestAuth.js";

export async function GET(request) {
  const auth = await requirePrincipal(request, { allowGuest: true, requireWrite: false });
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 20);
  const logs = await getAgentLogs(limit, { ownerUserId: auth.principal.userId });
  return Response.json({ logs });
}
