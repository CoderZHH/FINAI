import { getTickerRows, loadAllModelAllowedSymbols } from "../../../lib/dataRepository";

export async function GET() {
  await loadAllModelAllowedSymbols();
  const tickers = await getTickerRows();
  return Response.json({ tickers });
}
