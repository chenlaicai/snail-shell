/**
 * Logger 模块
 *
 * 提供日志服务的领域功能。
 *
 * 架构说明：
 * - types: 公开类型定义
 * - index: Logger 接口和工厂函数
 *
 * 依赖倒置：
 * - 本模块定义 Logger 接口
 * - 其他模块通过接口访问日志
 */

// ═══ 公开类型 ═══
export type { Logger, LoggerConfig, LogLevel } from "./types";

// ═══ 工厂函数 ═══

import type { Logger, LoggerConfig } from "./types";

/**
 * 创建 Logger 实例
 * @param config Logger 配置
 * @returns Logger 实例
 */
export function createLogger(config: LoggerConfig): Logger {
  // 这里是简单的控制台 Logger 实现
  // 实际实现应该写入文件
  return {
    debug(message: string, meta?: Record<string, unknown>) {
      if (config.level === "debug") {
        console.debug(`[DEBUG] ${message}`, meta ?? "");
      }
    },
    info(message: string, meta?: Record<string, unknown>) {
      if (["debug", "info"].includes(config.level)) {
        console.info(`[INFO] ${message}`, meta ?? "");
      }
    },
    warn(message: string, meta?: Record<string, unknown>) {
      if (["debug", "info", "warn"].includes(config.level)) {
        console.warn(`[WARN] ${message}`, meta ?? "");
      }
    },
    error(message: string, meta?: Record<string, unknown>) {
      console.error(`[ERROR] ${message}`, meta ?? "");
    },
  };
}
