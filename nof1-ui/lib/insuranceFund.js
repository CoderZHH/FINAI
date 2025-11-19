import { getPool } from "./db.js";

const FUND_ROW_ID = 1;

async function resolveClient(providedClient) {
  if (providedClient) return providedClient;
  const pool = await getPool();
  return pool;
}

export async function getInsuranceFundBalance(client) {
  const executor = await resolveClient(client);
  const { rows } = await executor.query(
    `SELECT balance FROM insurance_fund WHERE id = $1`,
    [FUND_ROW_ID]
  );
  if (!rows.length) return 0;
  const value = Number(rows[0].balance);
  return Number.isFinite(value) ? value : 0;
}

export async function creditInsuranceFund(amount, client) {
  if (!(Number.isFinite(amount) && amount > 0)) {
    return getInsuranceFundBalance(client);
  }
  const executor = await resolveClient(client);
  const current = await getInsuranceFundBalance(executor);
  const nextBalance = current + amount;
  await executor.query(
    `
    INSERT INTO insurance_fund (id, balance)
    VALUES ($1, $2)
    ON CONFLICT (id) DO UPDATE
    SET balance = EXCLUDED.balance,
        updated_at = now()
    `,
    [FUND_ROW_ID, nextBalance]
  );
  return nextBalance;
}

export async function debitInsuranceFund(amount, client) {
  if (!(Number.isFinite(amount) && amount > 0)) {
    const balance = await getInsuranceFundBalance(client);
    return { debited: 0, remainingBalance: balance };
  }
  const executor = await resolveClient(client);
  const current = await getInsuranceFundBalance(executor);
  const debited = Math.min(current, amount);
  const remainingBalance = Math.max(0, current - debited);
  await executor.query(
    `
    INSERT INTO insurance_fund (id, balance)
    VALUES ($1, $2)
    ON CONFLICT (id) DO UPDATE
    SET balance = EXCLUDED.balance,
        updated_at = now()
    `,
    [FUND_ROW_ID, remainingBalance]
  );
  return { debited, remainingBalance };
}
