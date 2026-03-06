/* eslint-disable no-console */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFromFile } from "./utils/loadEnv.js";
import { logger } from "../lib/infrastructure/logManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

async function bootstrap() {
  const envFile = process.env.ENV_FILE ?? path.resolve(PROJECT_ROOT, ".env.local");
  await loadEnvFromFile(envFile, { override: false });
  const { ensureRootUser } = await import("../lib/auth/authService.js");
  const { ensureUserBaseline } = await import("../lib/data/dataRepository.js");
  const { ensureAutoRunner } = await import("../lib/trading/autoRunner.js");
  const root = await ensureRootUser();
  if (root?.id) {
    await ensureUserBaseline(root.id);
  }
  logger.info("worker", "FINAI worker 启动中...");
  ensureAutoRunner();
  logger.info("worker", "FINAI worker 已启动 autoRunner");
}

bootstrap().catch((error) => {
  console.error("[worker] bootstrap failed:", error);
  logger.error("worker", "worker 启动失败", { error: error?.message });
  process.exitCode = 1;
});
