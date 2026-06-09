import fs from "fs";
import path from "path";

// LoggingConfig 和 LogLevel 类型定义（原从 persistence/logging-config-store 导入）
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggingConfig {
  level: LogLevel;
  directory: string;
  filename_prefix: string;
  max_file_size_mb: number;
  max_files: number;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function loadLoggingConfig(): LoggingConfig {
  const filePath = path.join(process.cwd(), "config", "logging.json");
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as LoggingConfig;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { level: "info", directory: "logs", filename_prefix: "snail-shell", max_file_size_mb: 10 };
    }
    throw err;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dayKey(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function buildLogFilename(config: LoggingConfig, day: string, index: number): string {
  return `${config.filename_prefix}-${day}.${index}.log`;
}

function resolveLogFilePath(config: LoggingConfig, day: string, index: number): string {
  return path.join(process.cwd(), config.directory, buildLogFilename(config, day, index));
}

export function ensureLoggingDirectory(config = loadLoggingConfig()): string {
  const dir = path.join(process.cwd(), config.directory);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getCurrentLogFilePath(config = loadLoggingConfig(), date = new Date()): string {
  ensureLoggingDirectory(config);
  const day = dayKey(date);
  const maxBytes = config.max_file_size_mb * 1024 * 1024;
  let index = 1;

  while (true) {
    const filePath = resolveLogFilePath(config, day, index);
    if (!fs.existsSync(filePath)) {
      return filePath;
    }
    const stats = fs.statSync(filePath);
    if (stats.size < maxBytes) {
      return filePath;
    }
    index += 1;
  }
}

export class Logger {
  private config: LoggingConfig;
  private currentDay = "";
  private currentIndex = 1;
  private currentFilePath = "";

  constructor() {
    this.config = loadLoggingConfig();
    ensureLoggingDirectory(this.config);
  }

  debug(message: string, meta?: Record<string, unknown>) {
    this.write("debug", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>) {
    this.write("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>) {
    this.write("warn", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>) {
    this.write("error", message, meta);
  }

  private shouldLog(level: LogLevel): boolean {
    this.config = loadLoggingConfig();
    return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[this.config.level];
  }

  private ensureStream() {
    const today = dayKey();

    if (this.currentDay !== today) {
      this.rotate(today, 1);
      return;
    }

    if (!this.currentFilePath) {
      this.rotate(today, this.currentIndex || 1);
      return;
    }

    if (this.currentFilePath && fs.existsSync(this.currentFilePath)) {
      const stats = fs.statSync(this.currentFilePath);
      const maxBytes = this.config.max_file_size_mb * 1024 * 1024;
      if (stats.size >= maxBytes) {
        this.rotate(today, this.currentIndex + 1);
      }
    } else {
      this.currentFilePath = resolveLogFilePath(this.config, today, this.currentIndex || 1);
    }
  }

  private rotate(day: string, index: number) {
    this.currentDay = day;
    this.currentIndex = index;
    const filePath = resolveLogFilePath(this.config, day, index);
    this.currentFilePath = filePath;
  }

  /**
   * 自定义 JSON 序列化，提取 Error 对象的 name/message/stack。
   * JSON.stringify(new Error()) 默认输出 {}，因为 Error 的属性不可枚举。
   */
  private serializeMeta(meta: Record<string, unknown>): string {
    try {
      return JSON.stringify(meta, (_key: string, value: unknown) => {
        if (value instanceof Error) {
          return { name: value.name, message: value.message, stack: value.stack };
        }
        return value;
      });
    } catch {
      return "[unserializable]";
    }
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    if (!this.shouldLog(level)) {
      return;
    }
    this.ensureStream();
    const timestamp = new Date().toISOString();
    const serializedMeta = meta && Object.keys(meta).length > 0 ? ` ${this.serializeMeta(meta)}` : "";
    const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${serializedMeta}\n`;
    fs.appendFileSync(this.currentFilePath, line, "utf8");
  }
}

export const logger = new Logger();
