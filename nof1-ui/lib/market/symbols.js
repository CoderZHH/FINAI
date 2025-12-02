const DEFAULT_SEED_SYMBOLS = [];

export function normalizeSymbol(symbol) {
  if (!symbol) return symbol;
  const upper = String(symbol).toUpperCase();
  return upper.endsWith("USDT") ? upper.slice(0, -4) : upper;
}

export function ensureMarketSymbol(symbol) {
  if (!symbol) return symbol;
  const upper = String(symbol).toUpperCase();
  return upper.endsWith("USDT") ? upper : `${upper}USDT`;
}

export function parseSeedSymbols() {
  return [...DEFAULT_SEED_SYMBOLS];
}

export function getDefaultSeedSymbols() {
  return [...DEFAULT_SEED_SYMBOLS];
}
