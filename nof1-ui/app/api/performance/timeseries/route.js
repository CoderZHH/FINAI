import { getPerformanceTimeseries } from "../../../../lib/data/dataRepository";
import { requirePrincipal } from "../../../../lib/auth/requestAuth.js";

export async function GET(request) {
  const auth = await requirePrincipal(request, { allowGuest: true, requireWrite: false });
  if (!auth.ok) return auth.response;
  const seriesData = await getPerformanceTimeseries({ ownerUserId: auth.principal.userId });
  return Response.json({ ...seriesData, serverTime: Date.now() });
}
