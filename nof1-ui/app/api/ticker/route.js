import { getTickerRows } from "../../../lib/dataRepository";

export async function GET() {
  const tickers = await getTickerRows();
  return Response.json({ tickers });
}
