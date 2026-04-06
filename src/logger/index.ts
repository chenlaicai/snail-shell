import fs from "fs";
import path from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LoggingConfig {
  level: LogLevel;
  directory: string;
  filename_prefix: string;
  max_file_size_mb: number;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function loadLoggingConfig(): LoggingConfig {
  const filePath = path.join(process.cwd(), "config", "logging.json");
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as LoggingConfig;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dayKey(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export class Logger {
  private config: LoggingConfig;
  private stream: fs.WriteStream | null = null;
  private currentDay = "";
  private currentIndex = 1;
  private currentFilePath = "";

  constructor() {
    this.config = loadLoggingConfig();
    const dir = path.join(process.cwd(), this.config.directory);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
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
    return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[this.config.level];
  }

  private ensureStream() {
    const today = dayKey();
    const dir = path.join(process.cwd(), this.config.directory);

    if (this.currentDay !== today) {
      this.rotate(today, 1);
      return;
    }

    if (!this.stream) {
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
      const filePath = path.join(dir, this.buildFilename(today, this.currentIndex || 1));
      this.currentFilePath = filePath;
    }
  }

  private rotate(day: string, index: number) {
    if (this.stream) {
      this.stream.end();
    }
    this.currentDay = day;
    this.currentIndex = index;
    const filePath = path.join(process.cwd(), this.config.directory, this.buildFilename(day, index));
    this.currentFilePath = filePath;
    this.stream = fs.createWriteStream(filePath, { flags: "a" });
  }

  private buildFilename(day: string, index: number): string {
    return `${this.config.filename_prefix}-${day}.${index}.log`;
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    if (!this.shouldLog(level)) {
      return;
    }
    this.ensureStream();
    const timestamp = new Date().toISOString();
    const serializedMeta = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
    const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${serializedMeta}\n`;
    this.stream?.write(line);
  }
}

export const logger = new Logger();
