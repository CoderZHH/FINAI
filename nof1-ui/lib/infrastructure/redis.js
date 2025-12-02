import Redis from "ioredis";
import { logger } from "./logManager.js";

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
      logger.error("redis", "连接异常", { error: err?.message });
    });
  }

  return cachedClient;
}
