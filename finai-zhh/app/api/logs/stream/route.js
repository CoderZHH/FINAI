import { logManager, logger } from "../../../../lib/infrastructure/logManager.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * SSE (Server-Sent Events) 端点用于实时流式传输服务器日志到浏览器
 * 
 * 使用场景:
 * - 前端开发者需要实时查看 AI 模型执行日志
 * - 监控自动化交易决策过程
 * - 调试 LLM API 调用和响应
 * 
 * 请求示例:
 *   GET /api/logs/stream
 * 
 * 响应格式 (SSE):
 *   data: {"timestamp":"2025-01-21T10:30:00.000Z","level":"info","module":"autoRunner","message":"模型 gpt-5 开始调用 AI","data":{"model_id":"gpt-5"}}
 *   
 *   data: {"timestamp":"2025-01-21T10:30:02.500Z","level":"info","module":"decisionEngine","message":"模型 gpt-5 返回结果","data":{"elapsed_ms":2500}}
 */
export async function GET(request) {
  // 创建 SSE 流
  const encoder = new TextEncoder();
  
  let cleanup = null;

  const stream = new ReadableStream({
    start(controller) {
      // 发送初始连接消息
      const initMessage = `data: ${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        module: "logStream",
        message: "日志流已连接",
        data: { connected: true }
      })}\n\n`;
      controller.enqueue(encoder.encode(initMessage));

      // 订阅 logManager 的新日志
      cleanup = logManager.subscribe((logEntry) => {
        try {
          const data = `data: ${JSON.stringify(logEntry)}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch (err) {
          if (cleanup) cleanup();
          logger.error("api:logs", "编码日志条目失败，已终止订阅", {
            error: err?.message,
          });
        }
      });

      // 定期发送心跳保持连接
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch (err) {
          if (cleanup) cleanup();
          logger.error("api:logs", "心跳发送失败，已终止订阅", {
            error: err?.message,
          });
          clearInterval(heartbeat);
        }
      }, 15000); // 每 15 秒发送心跳

      // 当客户端断开连接时清理
      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        if (cleanup) cleanup();
        try {
          controller.close();
        } catch (err) {
          // 流可能已经关闭
        }
      });
    },

    cancel() {
      // 客户端主动取消流
      if (cleanup) cleanup();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
