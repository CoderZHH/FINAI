export const runtime = "nodejs";

import { logger } from "./lib/infrastructure/logManager.js";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureAutoRunner } = await import("./lib/trading/autoRunner.js");
    logger.info("instrumentation", "启动 autoRunner...");
    ensureAutoRunner();
    logger.info("instrumentation", "autoRunner 已启动");
  }
}
