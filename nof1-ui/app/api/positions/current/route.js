import { getPositionsSnapshot } from "../../../../lib/data/dataRepository";

export async function GET() {
  const accountTotals = await getPositionsSnapshot();
  return Response.json({ accountTotals, serverTime: Date.now() });
}
