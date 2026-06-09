/**
 * Logger 模块公开类型
 *
 * 定义日志服务的领域类型。
 *
 * 设计原则：
 * - 只定义本模块的领域类型
 * - 不依赖其他模块的类型
 * - 通过 Logger 接口访问日志
 */

/**
 * 日志级别
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Logger 配置
 */
export interface LoggerConfig {
  /** 日志级别 */
  level: LogLevel;
  /** 日志目录 */
  dir: string;
  /** 最大文件大小（字节） */
  maxSize: number;
  /** 最大文件数量 */
  maxFiles: number;
}

/**
 * Logger 接口
 *
 * 定义日志服务的操作。
 */
export interface Logger {
  /**
   * 调试日志
   * @param message 日志消息
   * @param meta 元数据
   */
  debug(message: string, meta?: Record<string, unknown>): void;

  /**
   * 信息日志
   * @param message 日志消息
   * @param meta 元数据
   */
  info(message: string, meta?: Record<string, unknown>): void;

  /**
   * 警告日志
   * @param message 日志消息
   * @param meta 元数据
   */
  warn(message: string, meta?: Record<string, unknown>): void;

  /**
   * 错误日志
   * @param message 日志消息
   * @param meta 元数据
   */
  error(message: string, meta?: Record<string, unknown>): void;
}
