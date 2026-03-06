import crypto from "node:crypto";
import { getPool } from "../infrastructure/db.js";

const SESSION_TTL_DAYS = Number(process.env.FINAI_SESSION_TTL_DAYS ?? 30);

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hashed = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hashed}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, expected] = storedHash.split(":");
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(actual, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

async function ensureAuthSchema() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'USER',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      token TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx
    ON user_sessions(user_id);
  `);
}

export async function ensureRootUser() {
  await ensureAuthSchema();
  const pool = getPool();
  const passwordHash = hashPassword("root");
  const { rows } = await pool.query(
    `
    INSERT INTO users (username, password_hash, role)
    VALUES ('root', $1, 'SUPER_ADMIN')
    ON CONFLICT (username) DO UPDATE
    SET role = EXCLUDED.role
    RETURNING id, username, role
    `,
    [passwordHash]
  );
  return rows[0];
}

export async function createUser({ username, password, role = "USER" }) {
  await ensureAuthSchema();
  const normalized = String(username ?? "").trim();
  const pwd = String(password ?? "");
  if (!normalized) throw new Error("username is required");
  if (pwd.length < 6) throw new Error("password must be at least 6 characters");

  const pool = getPool();
  const passwordHash = hashPassword(pwd);
  const { rows } = await pool.query(
    `
    INSERT INTO users (username, password_hash, role)
    VALUES ($1, $2, $3)
    RETURNING id, username, role, created_at
    `,
    [normalized, passwordHash, role]
  );
  return rows[0];
}

export async function getUserByUsername(username) {
  await ensureAuthSchema();
  const normalized = String(username ?? "").trim();
  if (!normalized) return null;
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT id, username, role, password_hash, created_at
    FROM users
    WHERE username = $1
    LIMIT 1
    `,
    [normalized]
  );
  return rows[0] ?? null;
}

export async function verifyUserCredentials(username, password) {
  const user = await getUserByUsername(username);
  if (!user) return null;
  const valid = verifyPassword(String(password ?? ""), user.password_hash);
  if (!valid) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
  };
}

export async function createSession(userId) {
  await ensureAuthSchema();
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const pool = getPool();
  await pool.query(
    `
    INSERT INTO user_sessions (token, user_id, expires_at)
    VALUES ($1, $2, $3)
    `,
    [token, userId, expiresAt]
  );
  return {
    token,
    expiresAt,
  };
}

export async function getSessionByToken(token) {
  await ensureAuthSchema();
  if (!token) return null;
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT
      s.token,
      s.expires_at,
      u.id AS user_id,
      u.username,
      u.role
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = $1
    LIMIT 1
    `,
    [token]
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await deleteSession(token);
    return null;
  }
  return {
    token: row.token,
    expiresAt: row.expires_at,
    user: {
      id: row.user_id,
      username: row.username,
      role: row.role,
    },
  };
}

export async function deleteSession(token) {
  await ensureAuthSchema();
  if (!token) return;
  const pool = getPool();
  await pool.query(
    `
    DELETE FROM user_sessions
    WHERE token = $1
    `,
    [token]
  );
}

export async function cleanupExpiredSessions() {
  await ensureAuthSchema();
  const pool = getPool();
  await pool.query(
    `
    DELETE FROM user_sessions
    WHERE expires_at < now()
    `
  );
}
