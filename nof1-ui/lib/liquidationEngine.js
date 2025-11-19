import { getMMR } from "./riskLimits.js";
import {
  getInsuranceFundBalance,
  debitInsuranceFund,
  creditInsuranceFund,
} from "./insuranceFund.js";
import { logger } from "./logManager.js";

const DEFAULT_RESULT = { action: "hold", details: null };

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeMode(mode) {
  return String(mode ?? "cross").toLowerCase();
}

function computeNotional(position) {
  const entry = toNumber(position?.entry_price ?? 0);
  const qty = Math.abs(toNumber(position?.quantity ?? 0));
  return entry * qty;
}

function resolvePositionMargin(position, notional) {
  const leverage = Math.max(1, toNumber(position?.leverage ?? 1));
  const fallback = notional / leverage;
  if (position?.position_margin != null) {
    const explicit = toNumber(position.position_margin);
    return explicit > 0 ? explicit : fallback;
  }
  return fallback;
}

async function buildPositionSnapshot(position, markPriceFetcher, defaultMode) {
  const notional = computeNotional(position);
  if (!notional) return null;
  const mmr = await getMMR(position.symbol, notional);
  const markPrice =
    typeof markPriceFetcher === "function"
      ? toNumber(await markPriceFetcher(position.symbol), toNumber(position.entry_price ?? 0))
      : toNumber(position.entry_price ?? 0);
  const marginMode = normalizeMode(position.margin_mode ?? defaultMode);
  const positionMargin = resolvePositionMargin(position, notional);
  const maintenanceMargin = notional * (Number.isFinite(mmr) ? Number(mmr) : 0);
  const upnl =
    position.unrealized_pnl != null
      ? toNumber(position.unrealized_pnl)
      : (markPrice - toNumber(position.entry_price ?? 0)) * toNumber(position.quantity ?? 0);

  return {
    position,
    symbol: position.symbol,
    side: position.side ?? (toNumber(position.quantity ?? 0) >= 0 ? "LONG" : "SHORT"),
    mode: marginMode,
    markPrice,
    notional,
    mmr: Number.isFinite(mmr) ? Number(mmr) : 0,
    positionMargin,
    maintenanceMargin,
    upnl,
  };
}

export async function computeLiquidationPrice(position, imr, mmr, markPrice, marginMode) {
  const entryPrice = toNumber(position?.entry_price ?? 0);
  const quantity = toNumber(position?.quantity ?? 0);
  if (!entryPrice || !quantity) return null;
  const notional = Math.abs(entryPrice * quantity);
  if (!notional) return null;

  const margin = resolvePositionMargin(position, notional);
  const maintenance = notional * (Number.isFinite(mmr) ? Number(mmr) : 0);
  const qtyAbs = Math.abs(quantity);
  if (!qtyAbs) return null;

  let liquidationPrice;
  if (quantity > 0) {
    liquidationPrice = entryPrice - (margin - maintenance) / qtyAbs;
  } else {
    liquidationPrice = entryPrice + (margin - maintenance) / qtyAbs;
  }

  if (!Number.isFinite(liquidationPrice)) {
    return toNumber(markPrice ?? entryPrice);
  }
  if (normalizeMode(marginMode) === "cross") {
    return toNumber(markPrice ?? liquidationPrice);
  }
  return Number(liquidationPrice);
}

function summarizeLossMetrics(positionsInfo, marginMode, accountRuntime) {
  const totalLoss = positionsInfo.reduce((acc, snap) => {
    const pnl = snap.upnl;
    return pnl < 0 ? acc + Math.abs(pnl) : acc;
  }, 0);

  let userMarginCap = 0;
  if (marginMode === "isolated") {
    userMarginCap = positionsInfo.reduce((sum, snap) => sum + snap.positionMargin, 0);
  } else {
    const walletBalance = toNumber(
      accountRuntime.wallet_balance ?? accountRuntime.available_cash ?? 0
    );
    const positionMargin = toNumber(accountRuntime.position_margin ?? 0);
    userMarginCap = Math.max(0, walletBalance + positionMargin);
  }

  const coveredByUserMargin = Math.min(totalLoss, userMarginCap);
  const remainingLoss = Math.max(0, totalLoss - coveredByUserMargin);

  return {
    totalLoss,
    userMarginCap,
    coveredByUserMargin,
    remainingLoss,
  };
}

async function applyInsuranceCoverage(remainingLoss) {
  if (remainingLoss <= 0) {
    return { coveredByInsurance: 0, adlLoss: 0 };
  }
  const { debited, remainingBalance } = await debitInsuranceFund(remainingLoss);
  const coveredByInsurance = Number.isFinite(debited) ? debited : 0;
  const adlLoss = Math.max(0, remainingLoss - coveredByInsurance);
  return { coveredByInsurance, adlLoss, remainingBalance };
}

export async function runLiquidationCheckForAccount(
  accountRuntime = {},
  positions = [],
  riskConfig = {}
) {
  if (!positions?.length) {
    return { ...DEFAULT_RESULT };
  }

  const walletBalance = toNumber(accountRuntime.wallet_balance ?? accountRuntime.available_cash ?? 0);
  const totalUnrealized = toNumber(accountRuntime.total_unrealized_pnl ?? 0);
  const defaultMode = normalizeMode(accountRuntime.margin_mode ?? "cross");
  const markFetcher =
    typeof riskConfig.getMarkPrice === "function" ? riskConfig.getMarkPrice : async () => null;

  const snapshots = [];
  for (const position of positions) {
    const snapshot = await buildPositionSnapshot(position, markFetcher, defaultMode);
    if (snapshot) snapshots.push(snapshot);
  }
  if (!snapshots.length) {
    return { ...DEFAULT_RESULT };
  }

  const isolatedViolations = snapshots.filter(
    (snap) => snap.mode === "isolated" && snap.positionMargin + snap.upnl <= snap.maintenanceMargin
  );
  if (isolatedViolations.length) {
    logger.info("liquidationEngine.branch", {
      model_id: accountRuntime.model_id,
      mode: "isolated",
      positions_count: isolatedViolations.length,
    });
    const details = await forceLiquidateIsolated(isolatedViolations, accountRuntime);
    logger.info("liquidationEngine.runLiquidationCheckForAccount", {
      model_id: accountRuntime.model_id,
      margin_mode: "isolated",
      equity: walletBalance + totalUnrealized,
      totalMM: null,
      requiredLoss: details.requiredLoss,
      coveredByUserMargin: details.coveredByUserMargin,
      coveredByInsurance: details.coveredByInsurance,
      adlLoss: details.adlLoss,
      positions_count: positions.length,
    });
    return {
      action: "liquidate_isolated",
      details,
    };
  }

  const crossPositions = snapshots.filter((snap) => snap.mode !== "isolated");
  if (crossPositions.length) {
    const totalMM = crossPositions.reduce((sum, snap) => sum + snap.maintenanceMargin, 0);
    const equity = walletBalance + totalUnrealized;
    if (equity <= totalMM) {
      logger.info("liquidationEngine.branch", {
        model_id: accountRuntime.model_id,
        mode: "cross",
        positions_count: crossPositions.length,
      });
      const details = await forceLiquidateCross(accountRuntime, crossPositions, markFetcher, totalMM);
      logger.info("liquidationEngine.runLiquidationCheckForAccount", {
        model_id: accountRuntime.model_id,
        margin_mode: "cross",
        equity,
        totalMM,
        requiredLoss: details.requiredLoss,
        coveredByUserMargin: details.coveredByUserMargin,
        coveredByInsurance: details.coveredByInsurance,
        adlLoss: details.adlLoss,
        positions_count: positions.length,
      });
      return {
        action: "liquidate_cross",
        details,
      };
    }
  }

  return { ...DEFAULT_RESULT };
}

export async function forceLiquidateIsolated(violations, accountRuntime) {
  const list = Array.isArray(violations) ? violations : [violations];
  const positionsToClose = await Promise.all(
    list.map(async (snap) => {
      const liqPrice = await computeLiquidationPrice(
        snap.position,
        null,
        snap.mmr,
        snap.markPrice,
        "isolated"
      );
      return {
        position: snap.position,
        symbol: snap.symbol,
        side: snap.side ?? snap.position?.side ?? "LONG",
        liquidationPrice: liqPrice,
        markPrice: snap.markPrice,
        notional: snap.notional,
        mmr: snap.mmr,
        maintenanceMargin: snap.maintenanceMargin,
      };
    })
  );

  const lossMetrics = summarizeLossMetrics(list, "isolated", accountRuntime);
  const insuranceResult = await applyInsuranceCoverage(lossMetrics.remainingLoss);

  const details = {
    mode: "isolated",
    positionsToClose,
    adl: insuranceResult.adlLoss > 0,
    requiredLoss: lossMetrics.totalLoss,
    coveredByUserMargin: lossMetrics.coveredByUserMargin,
    coveredByInsurance: insuranceResult.coveredByInsurance,
    adlLoss: insuranceResult.adlLoss,
  };

  if (insuranceResult.coveredByInsurance > 0) {
    await creditInsuranceFund(0); // placeholder to ensure module import is used
  }

  return details;
}

export async function forceLiquidateCross(accountRuntime, positionsInfo, markPriceFetcher, totalMM) {
  const positionsToClose = [];
  for (const snap of positionsInfo) {
    const markPrice =
      snap.markPrice ??
      (typeof markPriceFetcher === "function" ? await markPriceFetcher(snap.symbol) : null);
    const liqPrice = await computeLiquidationPrice(
      snap.position,
      null,
      snap.mmr,
      markPrice,
      "cross"
    );
    positionsToClose.push({
      position: snap.position,
      symbol: snap.symbol,
      side: snap.side ?? snap.position?.side ?? "LONG",
      liquidationPrice: liqPrice,
      markPrice: markPrice ?? snap.markPrice ?? toNumber(snap.position.entry_price ?? 0),
      notional: snap.notional,
      mmr: snap.mmr,
      maintenanceMargin: snap.maintenanceMargin,
    });
  }

  const lossMetrics = summarizeLossMetrics(positionsInfo, "cross", accountRuntime);
  const insuranceResult = await applyInsuranceCoverage(lossMetrics.remainingLoss);

  const walletBalance = toNumber(accountRuntime.wallet_balance ?? accountRuntime.available_cash ?? 0);
  const equity = walletBalance + toNumber(accountRuntime.total_unrealized_pnl ?? 0);

  const details = {
    mode: "cross",
    positionsToClose,
    adl: insuranceResult.adlLoss > 0 || equity < 0,
    requiredLoss: lossMetrics.totalLoss,
    coveredByUserMargin: lossMetrics.coveredByUserMargin,
    coveredByInsurance: insuranceResult.coveredByInsurance,
    adlLoss: insuranceResult.adlLoss + Math.max(0, -equity),
    totalMaintenance: totalMM,
    equity,
  };

  return details;
}
