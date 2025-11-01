import { Pool } from "pg";

let cachedPool = null;

/**
 * Create (or reuse) a PostgreSQL connection pool.
 * The pool is cached on the Node.js process to avoid opening
 * a new set of connections for every API invocation.
 */
export function getPool() {
  if (!process.env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL environment variable is required.");
  }

  if (!cachedPool) {
    cachedPool = new Pool({
      connectionString: process.env.POSTGRES_URL,
      ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    });

    cachedPool.on("error", (err) => {
      console.error("[PostgreSQL] unexpected error", err);
    });
  }

  return cachedPool;
}
