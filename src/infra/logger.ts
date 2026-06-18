import fs from "fs";
import path from "path";
import { ConfigStore } from "@infra/config-store";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LoggingConfig {
  level?: LogLevel;
  directory?: string;
  max_file_size_mb?: number;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_CONFIG: Required<LoggingConfig> = {
  level: "info",
  directory: "logs",
  max_file_size_mb: 10,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dayKey(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export class Logger {
  private config: Required<LoggingConfig>;
  private currentDay = "";
  private currentIndex = 1;
  private currentFilePath = "";

  constructor(repoRoot?: string) {
    const userConfig = repoRoot
      ? new ConfigStore(repoRoot).readYaml<LoggingConfig>("logging.yaml") ?? {}
      : {};
    this.config = { ...DEFAULT_CONFIG, ...userConfig };
    this.ensureDirectory();
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.write("debug", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write("warn", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write("error", message, meta);
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[this.config.level];
  }

  private ensureDirectory(): void {
    const dir = path.resolve(this.config.directory);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private resolveFilePath(): void {
    const today = dayKey();
    const dir = path.resolve(this.config.directory);
    const maxBytes = this.config.max_file_size_mb * 1024 * 1024;

    if (this.currentDay !== today) {
      this.currentDay = today;
      this.currentIndex = 1;
    }

    while (true) {
      const filePath = path.join(dir, `snail-shell-${today}.${this.currentIndex}.log`);
      if (!fs.existsSync(filePath)) {
        this.currentFilePath = filePath;
        return;
      }
      const stats = fs.statSync(filePath);
      if (stats.size < maxBytes) {
        this.currentFilePath = filePath;
        return;
      }
      this.currentIndex++;
    }
  }

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

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    this.resolveFilePath();
    const timestamp = new Date().toISOString();
    const metaStr = meta && Object.keys(meta).length > 0 ? ` ${this.serializeMeta(meta)}` : "";
    const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}\n`;

    try {
      fs.appendFileSync(this.currentFilePath, line, "utf8");
    } catch {
      // 日志写入失败不应影响业务
    }
  }
}

let instance: Logger | null = null;

export function getLogger(): Logger {
  if (!instance) {
    instance = new Logger(process.cwd());
  }
  return instance;
}
