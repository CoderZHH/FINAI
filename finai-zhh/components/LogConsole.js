"use client";

import { useEffect, useRef } from "react";
import { logger } from "../lib/infrastructure/logManager.js";

/**
 * LogConsole 组件
 * 
 * 订阅服务器端日志流并输出到浏览器控制台
 * 用于开发调试,让前端开发者能看到后台 AI 模型执行的详细日志
 * 
 * 使用方式:
 *   <LogConsole /> // 在 layout.js 中全局挂载
 * 
 * 功能:
 * - 通过 SSE 实时接收服务器日志
 * - 根据日志级别输出到 console.log/warn/error
 * - 自动重连机制(断线 3 秒后重试)
 * - 支持日志数据结构化展示
 */
export default function LogConsole() {
  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    function connect() {
      if (!mounted) return;

      const infoLog = (message, data) => logger.info("LogConsole", message, data);
      infoLog("连接到服务器日志流...");

      try {
        const eventSource = new EventSource("/api/logs/stream");
        eventSourceRef.current = eventSource;

        eventSource.onmessage = (event) => {
          if (!mounted) return;

          try {
            const logEntry = JSON.parse(event.data);
            const { timestamp, level, module, message, data } = logEntry;

            // 格式化时间戳
            const time = new Date(timestamp).toLocaleTimeString("zh-CN", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              fractionalSecondDigits: 3,
            });

            // 根据级别选择控制台方法和颜色
            const infoLog = (msg, data) => logger.info("LogConsole", msg, data);
            const levelConfig = {
              debug: {
                method: console.debug,
                color: "#6b7280",
                emoji: "🔍",
              },
              info: {
                method: infoLog,
                color: "#3b82f6",
                emoji: "ℹ️",
              },
              warn: {
                method: console.warn,
                color: "#f59e0b",
                emoji: "⚠️",
              },
              error: {
                method: console.error,
                color: "#ef4444",
                emoji: "❌",
              },
            };

            const config = levelConfig[level] || levelConfig.info;

            // 输出日志到浏览器控制台
            if (config.method === infoLog) {
              config.method(
                `${config.emoji} [${time}] [${module}] ${message}`,
                data || null
              );
            } else {
              config.method(
                `%c${config.emoji} [${time}] [${module}]%c ${message}`,
                `color: ${config.color}; font-weight: bold`,
                "color: inherit",
                data || ""
              );
            }
          } catch (err) {
            console.error("[LogConsole] 解析日志条目失败:", err);
          }
        };

        eventSource.onerror = (error) => {
          console.error(
            "%c[LogConsole] EventSource 错误",
            "color: #ef4444; font-weight: bold",
            error
          );
          eventSource.close();
          eventSourceRef.current = null;

          // 3 秒后尝试重连
          if (mounted) {
            infoLog("3 秒后尝试重新连接...");
            reconnectTimeoutRef.current = setTimeout(() => {
              if (mounted) connect();
            }, 3000);
          }
        };

        eventSource.onopen = () => {
          infoLog("日志流连接成功");
        };
      } catch (err) {
        console.error(
          "%c[LogConsole] 创建 EventSource 失败:",
          "color: #ef4444; font-weight: bold",
          err
        );
      }
    }

    connect();

    // 清理函数
    return () => {
      mounted = false;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      if (eventSourceRef.current) {
        logger.info("LogConsole", "断开日志流连接");
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  // 此组件不渲染任何 UI,只在后台订阅日志
  return null;
}
