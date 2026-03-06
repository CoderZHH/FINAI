import { logger } from "@/lib/infrastructure/logManager";
import { getRecentTrades } from "../../../../lib/data/dataRepository";
import { requirePrincipal } from "../../../../lib/auth/requestAuth.js";

export async function GET(request) {
  const auth = await requirePrincipal(request, { allowGuest: true, requireWrite: false });
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") || 20);
    const trades = await getRecentTrades(limit, { ownerUserId: auth.principal.userId });
    return Response.json({ trades, serverTime: Date.now() });
  } catch (error) {
    logger.error("api:trades", "获取最新成交失败", { error: error?.message });
    return Response.json(
      { error: error.message, stack: error.stack },
      { status: 500 }
    );
  }
}
