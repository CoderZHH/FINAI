import { getAgentAccounts } from "../../../lib/dataRepository";

export async function GET() {
  const accounts = await getAgentAccounts();
  const rows = accounts
    .filter((account) => !account.baseline)
    .map((account) => ({
      model: account.name,
      pnl: account.pnl_pct * 100,
      sharpe: account.sharpe_ratio,
      win: Math.round(account.win_rate * 100),
      trades: account.total_trades,
    }));
  return Response.json({ rows });
}
