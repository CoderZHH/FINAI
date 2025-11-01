import { getRecentTrades } from "../../../lib/dataRepository";

export async function GET() {
  const trades = await getRecentTrades(100);
  return Response.json({ trades });
}
