/**
 * 集中式日志管理器
 * 
 * 功能:
 * 1. 统一服务器端日志接口 (logger.info/warn/error/debug)
 * 2. 内存缓冲最近的日志条目
 * 3. 通过订阅模式支持实时日志流 (SSE)
 * 
 * 使用示例:
 *   import { logger } from './logManager.js';
 *   logger.info('autoRunner', '模型开始执行', { model_id: 'gpt-5' });
 *   logger.error('llmClient', 'API 调用失败', { status: 500 });
 */

const LogLevel = {
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
};

// 内存中存储最近的日志 (最多 500 条)
const MAX_LOGS = 500;
const globalStore = globalThis.__logManagerStore ?? {
  logBuffer: [],
  subscribers: new Set(),
};
globalThis.__logManagerStore = globalStore;
const logBuffer = globalStore.logBuffer;
const subscribers = globalStore.subscribers;

/**
 * 添加日志条目
 */
function addLog(level, module, message, data = null) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    data,
  };

  // 保存到内存缓冲区
  logBuffer.push(logEntry);
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.shift(); // 移除最旧的日志
  }

  // 同时输出到控制台 (开发环境)
  const consoleMethod = level === "error" ? "error" : level === "warn" ? "warn" : "log";
  console[consoleMethod](`[${level.toUpperCase()}] [${module}] ${message}`, data || "");

  // 通知所有订阅者 (SSE)
  subscribers.forEach((callback) => {
    try {
      callback(logEntry);
    } catch (err) {
      console.error("[logManager] 通知订阅者失败:", err);
    }
  });
}

/**
 * 获取最近的日志
 */
function getRecentLogs(limit = 100) {
  return logBuffer.slice(-limit);
}

/**
 * 清空日志缓冲区
 */
function clearLogs() {
  logBuffer.length = 0;
}

/**
 * 订阅新日志 (用于 SSE)
 * @param {Function} callback - 接收日志条目的回调函数
 * @returns {Function} 取消订阅函数
 */
function subscribe(callback) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

/**
 * 便捷的日志记录器接口
 */
const logger = {
  debug: (module, message, data) => addLog(LogLevel.DEBUG, module, message, data),
  info: (module, message, data) => addLog(LogLevel.INFO, module, message, data),
  warn: (module, message, data) => addLog(LogLevel.WARN, module, message, data),
  error: (module, message, data) => addLog(LogLevel.ERROR, module, message, data),
};

// 导出所有公共接口
export { logger };
export const logManager = {
  addLog,
  getRecentLogs,
  clearLogs,
  subscribe,
  LogLevel,
};
