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

function safeSerialize(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    try {
      return String(value);
    } catch {
      return null;
    }
  }
}

function addLog(level, module, message, data = null) {
  const messageIsObject = message && typeof message === "object";
  const normalizedMessage = messageIsObject ? "[object]" : message;
  const normalizedData = messageIsObject && data == null
    ? safeSerialize(message)
    : safeSerialize(data);

  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message: normalizedMessage,
    data: normalizedData,
  };

  // 保存到内存缓冲区
  logBuffer.push(logEntry);
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.shift(); // 移除最旧的日志
  }

  // 同时输出到控制台 (开发环境)
  const consoleMethod = level === "error" ? "error" : level === "warn" ? "warn" : "log";
  console[consoleMethod](
    `[${level.toUpperCase()}] [${module}] ${normalizedMessage}`,
    normalizedData || ""
  );

  // 通知所有订阅者 (SSE)
  subscribers.forEach((callback) => {
    try {
      callback(logEntry);
    } catch (err) {
      console.error("[logManager] 通知订阅者失败:", err);
    }
  });
}

function getRecentLogs(limit = 100) {
  return logBuffer.slice(-limit);
}

function clearLogs() {
  logBuffer.length = 0;
}

function subscribe(callback) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

const logger = {
  debug: (module, message, data) => addLog(LogLevel.DEBUG, module, message, data),
  info: (module, message, data) => addLog(LogLevel.INFO, module, message, data),
  warn: (module, message, data) => addLog(LogLevel.WARN, module, message, data),
  error: (module, message, data) => addLog(LogLevel.ERROR, module, message, data),
};

export const logCalcEvent = (module, event, data = {}) =>
  addLog(LogLevel.INFO, module, `(计算) ${event}`, { event, ...data });
export const logCalc = (module, event, data) => logCalcEvent(module, event, data);

// 导出所有公共接口
export { logger };
export const logManager = {
  addLog,
  getRecentLogs,
  clearLogs,
  subscribe,
  LogLevel,
};
