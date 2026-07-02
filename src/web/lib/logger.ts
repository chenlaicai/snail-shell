/**
 * 轻量前端结构化日志工具。
 *
 * 提供统一的模块级 logger，替代原生 console.* 调用。
 * 当前实现委托给 console，未来可扩展为批量上报到后端。
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

const LEVEL_METHOD: Record<LogLevel, "log" | "info" | "warn" | "error"> = {
  debug: "log",
  info: "info",
  warn: "warn",
  error: "error",
};

export function getLogger(module: string): Logger {
  const prefix = `[${module}]`;

  function emit(level: LogLevel, message: string, ...args: unknown[]): void {
    console[LEVEL_METHOD[level]](prefix, message, ...args);
  }

  return {
    debug: (message, ...args) => emit("debug", message, ...args),
    info: (message, ...args) => emit("info", message, ...args),
    warn: (message, ...args) => emit("warn", message, ...args),
    error: (message, ...args) => emit("error", message, ...args),
  };
}
