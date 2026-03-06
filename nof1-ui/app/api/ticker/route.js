import {
  getMarketSnapshot,
  listAgentModels,
} from "../../../lib/data/dataRepository";
import { requirePrincipal } from "../../../lib/auth/requestAuth.js";

export async function GET(request) {
  const auth = await requirePrincipal(request, { allowGuest: true, requireWrite: false });
  if (!auth.ok) return auth.response;
  const models = await listAgentModels({
    includeDisabled: true,
    includeSecrets: false,
    ownerUserId: auth.principal.userId,
  });
  const symbols = Array.from(
    new Set(
      models
        .flatMap((model) => model.allowed_symbols ?? [])
        .map((symbol) => String(symbol ?? "").toUpperCase().replace(/USDT$/i, ""))
        .filter(Boolean)
    )
  );
  const snapshot = await getMarketSnapshot(symbols);
  const tickers = snapshot.order.map((symbol) => {
    const ticker = snapshot.prices[symbol];
    return {
      symbol: `${symbol}USDT`,
      price: Number(ticker?.price ?? 0),
      change: ticker?.change ?? null,
    };
  });
  return Response.json({ tickers });
}
