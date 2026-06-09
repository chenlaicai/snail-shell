/**
 * LoggingConfigStore — 从 config/logging.json 加载日志配置。
 *
 * Why: 原先 logger/index.ts 直接读取文件，违反持久化层统一入口原则。
 * 提取为独立 Store 后，所有配置文件读写都经过 persistence 层。
 */
import fs from "fs";
import path from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** 日志配置类型定义——从 logger/index.ts 迁移。 */
export interface LoggingConfig {
  level: LogLevel;
  directory: string;
  filename_prefix: string;
  max_file_size_mb: number;
}

export class LoggingConfigStore {
  private readonly configPath: string;
  private cachedConfig: LoggingConfig | null = null;

  constructor(configDir: string) {
    this.configPath = path.join(configDir, "logging.json");
  }

  /**
   * 获取日志配置。
   * 文件缺失 → 使用默认配置。
   */
  getConfig(): LoggingConfig {
    if (this.cachedConfig) return this.cachedConfig;

    if (!fs.existsSync(this.configPath)) {
      /** logging.json 是可选配置，缺失时使用默认值 */
      this.cachedConfig = {
        level: "info",
        directory: "logs",
        filename_prefix: "snail-shell",
        max_file_size_mb: 10,
      };
      return this.cachedConfig;
    }

    const raw = fs.readFileSync(this.configPath, "utf8");
    this.cachedConfig = JSON.parse(raw) as LoggingConfig;
    return this.cachedConfig;
  }
}
