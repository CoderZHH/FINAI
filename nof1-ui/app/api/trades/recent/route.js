import { logger } from "@/lib/infrastructure/logManager";
import { getRecentTrades } from "../../../../lib/data/dataRepository";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") || 20);
    const trades = await getRecentTrades(limit);
    return Response.json({ trades, serverTime: Date.now() });
  } catch (error) {
    logger.error("api:trades", "获取最新成交失败", { error: error?.message });
    return Response.json(
      { error: error.message, stack: error.stack },
      { status: 500 }
    );
  }
}
