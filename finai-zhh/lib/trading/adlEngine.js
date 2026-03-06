import { getPool } from "../infrastructure/db.js";
import { logger } from "../infrastructure/logManager.js";

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function computeAdlScore(account) {
  const startingEquity = Math.max(1, toNumber(account.starting_equity ?? 1));
  const equity = toNumber(account.latest_equity ?? startingEquity);
  const walletBalance = Math.max(1, toNumber(account.wallet_balance ?? equity));
  const profit = equity - startingEquity;
  const profitRatio = profit / startingEquity;
  const leverageProxy = equity / walletBalance;
  return {
    score: profitRatio * leverageProxy,
    profit,
    equity,
    startingEquity,
    walletBalance,
  };
}

export async function distributeAdlLoss(adlLoss) {
  const lossTarget = toNumber(adlLoss);
  if (!(lossTarget > 0)) {
    const emptyResult = { distributed: 0, affected: [] };
    logger.info("adlEngine", "分摊 ADL 损失 - 无需处理", {
      adlLossInput: adlLoss,
      distributed: 0,
      remaining: lossTarget,
      affected_count: 0,
      affected: [],
    });
    return emptyResult;
  }

  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT model_id, starting_equity, latest_equity, wallet_balance
    FROM agent_accounts_runtime
    `
  );

  const candidates = rows
    .map((row) => {
      const metrics = computeAdlScore(row);
      return {
        ...row,
        ...metrics,
      };
    })
    .filter((entry) => entry.profit > 0 && entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return toNumber(b.equity) - toNumber(a.equity);
    });

  if (!candidates.length) {
    return { distributed: 0, affected: [] };
  }

  let remaining = lossTarget;
  const affected = [];

  for (const account of candidates) {
    if (remaining <= 0) break;
    const maxShare = Math.max(0, account.equity - account.startingEquity);
    if (maxShare <= 0) continue;
    const deduction = Math.min(remaining, maxShare);
    const nextWallet = Math.max(0, account.wallet_balance - deduction);
    const nextEquity = Math.max(0, account.equity - deduction);

    await pool.query(
      `
      UPDATE agent_accounts_runtime
      SET
        wallet_balance = $1,
        latest_equity = $2,
        realized_pnl_price = realized_pnl_price - $3,
        updated_at = now()
      WHERE model_id = $4
      `,
      [nextWallet, nextEquity, deduction, account.model_id]
    );

    affected.push({
      model_id: account.model_id,
      deducted: deduction,
      beforeEquity: account.equity,
      afterEquity: nextEquity,
    });
    remaining -= deduction;
  }

  const distributed = lossTarget - remaining;
  const result = { distributed, affected };
  logger.info("adlEngine", "分摊 ADL 损失完成", {
    adlLossInput: adlLoss,
    distributed,
    remaining: lossTarget - distributed,
    affected_count: affected.length,
    affected: affected.map((entry) => ({
      model_id: entry.model_id,
      deducted: entry.deducted,
      beforeEquity: entry.beforeEquity,
      afterEquity: entry.afterEquity,
    })),
  });
  return result;
}
