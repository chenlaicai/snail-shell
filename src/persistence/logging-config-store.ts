import { JsonConfigStore } from "./json-config-store";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggingConfig {
  level: LogLevel;
  directory: string;
  filename_prefix: string;
  max_file_size_mb: number;
}

const DEFAULT_LOGGING_CONFIG: LoggingConfig = {
  level: "info",
  directory: "logs",
  filename_prefix: "snail-shell",
  max_file_size_mb: 10,
};

export class LoggingConfigStore {
  private readonly store: JsonConfigStore<LoggingConfig>;

  constructor(configDir: string) {
    this.store = new JsonConfigStore(configDir, "logging.json", DEFAULT_LOGGING_CONFIG, JSON.parse);
  }

  getConfig(): LoggingConfig {
    return this.store.get();
  }
}
