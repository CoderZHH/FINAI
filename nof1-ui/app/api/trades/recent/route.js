import { getRecentTrades } from "../../../../lib/dataRepository";

export async function GET(request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 20);
  const trades = await getRecentTrades(limit);
  return Response.json({ trades, serverTime: Date.now() });
}
