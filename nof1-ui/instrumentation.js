import { ensureAutoRunner } from "./lib/autoRunner.js";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log("[instrumentation] 启动 autoRunner...");
    ensureAutoRunner();
    console.log("[instrumentation] autoRunner 已启动");
  }
}
