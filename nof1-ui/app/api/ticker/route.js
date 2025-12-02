import { getTickerRows, loadAllModelAllowedSymbols } from "../../../lib/data/dataRepository";

export async function GET() {
  await loadAllModelAllowedSymbols();
  const tickers = await getTickerRows();
  return Response.json({ tickers });
}
