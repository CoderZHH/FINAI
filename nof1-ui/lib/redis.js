import Redis from "ioredis";

let cachedClient = null;

/**
 * Return a shared Redis client if REDIS_URL is configured.
 * The connection is reused across requests to minimise socket churn.
 */
export function getRedis() {
  if (!process.env.REDIS_URL) {
    return null;
  }

  if (!cachedClient) {
    cachedClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    cachedClient.on("error", (err) => {
      console.error("[Redis] unexpected error", err);
    });
  }

  return cachedClient;
}
