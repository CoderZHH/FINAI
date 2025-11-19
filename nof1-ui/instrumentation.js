import { ensureAutoRunner } from "./lib/autoRunner.js";
import { logger } from "./lib/logManager.js";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    logger.info("instrumentation", "启动 autoRunner...");
    ensureAutoRunner();
    logger.info("instrumentation", "autoRunner 已启动");
  }
}
