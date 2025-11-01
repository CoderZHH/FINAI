import { marketPrices } from "../../../../lib/mockData";

export async function GET() {
  return Response.json(marketPrices());
}

