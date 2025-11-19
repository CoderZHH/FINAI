const isNodeRuntime =
  typeof process !== "undefined" && !!process.versions?.node;

let fsModule = null;
let pathModule = null;
let CONFIG_PATH = null;

if (isNodeRuntime) {
  const fsImport = await import("node:fs");
  const pathImport = await import("node:path");
  const urlImport = await import("node:url");
  fsModule = fsImport.default ?? fsImport;
  pathModule = pathImport.default ?? pathImport;
  const __filename = urlImport.fileURLToPath(import.meta.url);
  const __dirname = pathModule.dirname(__filename);
  const projectRoot = pathModule.resolve(__dirname, "..");
  CONFIG_PATH =
    process.env.SIM_CONFIG_PATH ?? pathModule.join(projectRoot, "sim_config.json");
}

const DEFAULT_CONFIG = {
  symbols: {},
  fees: {
    default: {
      maker: 0.0002,
      taker: 0.0004,
    },
  },
  funding: {
    enabled: false,
    mode: "real",
    fixed_rate: 0.0001,
  },
};

let cachedConfig = null;
let memoryConfig = { ...DEFAULT_CONFIG };

function readConfigFile() {
  if (!isNodeRuntime || !fsModule || !CONFIG_PATH) {
    return { ...memoryConfig };
  }
  try {
    const raw = fsModule.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    console.warn(
      `[simConfig] Failed to read ${CONFIG_PATH}, using defaults.`,
      error?.message ?? error
    );
    return { ...DEFAULT_CONFIG };
  }
}

export function loadSimConfig() {
  if (!cachedConfig) {
    cachedConfig = { ...DEFAULT_CONFIG, ...readConfigFile() };
  }
  return cachedConfig;
}

export function saveSimConfig(nextConfig) {
  const merged = {
    ...DEFAULT_CONFIG,
    ...nextConfig,
    symbols: nextConfig.symbols ?? DEFAULT_CONFIG.symbols,
    fees: nextConfig.fees ?? DEFAULT_CONFIG.fees,
    funding: nextConfig.funding ?? DEFAULT_CONFIG.funding,
  };
  if (isNodeRuntime && fsModule && CONFIG_PATH) {
    fsModule.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  } else {
    memoryConfig = merged;
  }
  cachedConfig = merged;
  return merged;
}

export function updateSimConfig(updater) {
  const current = loadSimConfig();
  const next = updater({ ...current });
  return saveSimConfig(next);
}

function buildSymbolCandidates(symbol) {
  if (!symbol) return [];
  const upper = String(symbol).toUpperCase();
  const candidates = [upper];
  if (!upper.endsWith("USDT")) {
    candidates.push(`${upper}USDT`);
  } else {
    candidates.push(upper.replace(/USDT$/, ""));
  }
  return candidates;
}

export function getSymbolConfig(symbol) {
  const cfg = loadSimConfig();
  const candidates = buildSymbolCandidates(symbol);
  for (const candidate of candidates) {
    if (cfg.symbols?.[candidate]) return cfg.symbols[candidate];
  }
  return {};
}

export function getFeeRate(symbol, liquidity) {
  const cfg = loadSimConfig();
  const candidates = buildSymbolCandidates(symbol);
  let symCfg = null;
  for (const candidate of candidates) {
    if (cfg.fees?.[candidate]) {
      symCfg = cfg.fees[candidate];
      break;
    }
  }
  if (!symCfg) {
    symCfg = cfg.fees?.default ?? DEFAULT_CONFIG.fees.default;
  }
  if (liquidity === "maker") return Number(symCfg.maker ?? 0) || 0;
  if (liquidity === "taker") return Number(symCfg.taker ?? 0) || 0;
  throw new Error(`Invalid liquidity type "${liquidity}", expected maker/taker.`);
}

export function getFundingConfig() {
  const cfg = loadSimConfig();
  return {
    enabled: Boolean(cfg.funding?.enabled),
    mode: cfg.funding?.mode ?? "real",
    fixed_rate:
      typeof cfg.funding?.fixed_rate === "number"
        ? cfg.funding.fixed_rate
        : DEFAULT_CONFIG.funding.fixed_rate,
  };
}

export function getMarginModeForModel(modelConfig, symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  const cfg = modelConfig?.margin_config ?? {};
  const mode = cfg[sym];
  if (mode === "isolated" || mode === "cross") {
    return mode;
  }
  return "cross";
}
