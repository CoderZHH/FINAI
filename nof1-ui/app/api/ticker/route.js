import { tickers } from "../../../lib/mockData";

export async function GET() {
  return Response.json({ tickers });
}

