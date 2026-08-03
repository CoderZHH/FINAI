import { logger } from "@/lib/infrastructure/logManager";
import { getRecentTrades } from "../../../../lib/data/dataRepository";
import { requirePrincipal } from "../../../../lib/auth/requestAuth.js";

export async function GET(request) {
  const auth = await requirePrincipal(request, { allowGuest: true, requireWrite: false });
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") || 20);
    const beforeEntryTime = url.searchParams.get("beforeEntryTime");
    const beforeId = url.searchParams.get("beforeId");
    const trades = await getRecentTrades(limit, {
      ownerUserId: auth.principal.userId,
      beforeEntryTime,
      beforeId,
      completedOnly: true,
    });
    const lastTrade = trades.at(-1) ?? null;
    return Response.json({
      trades,
      hasMore: trades.length === limit,
      nextCursor: lastTrade
        ? {
            beforeEntryTime: lastTrade.entry_time,
            beforeId: lastTrade.id,
          }
        : null,
      serverTime: Date.now(),
    });
  } catch (error) {
    logger.error("api:trades", "获取最新成交失败", { error: error?.message });
    return Response.json(
      { error: error.message, stack: error.stack },
      { status: 500 }
    );
  }
}
