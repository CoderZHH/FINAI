import { getPositionsSnapshot } from "../../../../lib/data/dataRepository";
import { requirePrincipal } from "../../../../lib/auth/requestAuth.js";

export async function GET(request) {
  const auth = await requirePrincipal(request, { allowGuest: true, requireWrite: false });
  if (!auth.ok) return auth.response;
  const accountTotals = await getPositionsSnapshot({ ownerUserId: auth.principal.userId });
  return Response.json({ accountTotals, serverTime: Date.now() });
}
