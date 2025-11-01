import { getMarketSnapshot } from "../../../../lib/dataRepository";

export async function GET() {
  const snapshot = await getMarketSnapshot();
  return Response.json(snapshot);
}
