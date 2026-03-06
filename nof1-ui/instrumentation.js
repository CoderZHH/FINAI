export const runtime = "nodejs";

import { logger } from "./lib/infrastructure/logManager.js";

export async function register() {
  const shouldStartInWeb = process.env.FINAI_AUTORUNNER_IN_WEB === "true";
  if (process.env.NEXT_RUNTIME === "nodejs" && shouldStartInWeb) {
    const { ensureAutoRunner } = await import("./lib/trading/autoRunner.js");
    logger.info("instrumentation", "启动 autoRunner...");
    ensureAutoRunner();
    logger.info("instrumentation", "autoRunner 已启动");
    return;
  }
  logger.info("instrumentation", "跳过 autoRunner 启动（由独立 worker 负责）");
}
