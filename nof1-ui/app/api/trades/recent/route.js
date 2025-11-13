import { getRecentTrades } from "../../../../lib/dataRepository";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") || 20);
    const trades = await getRecentTrades(limit);
    return Response.json({ trades, serverTime: Date.now() });
  } catch (error) {
    console.error("[API /trades/recent] Error:", error);
    return Response.json(
      { error: error.message, stack: error.stack },
      { status: 500 }
    );
  }
}
