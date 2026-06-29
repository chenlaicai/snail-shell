import path from "path";
import pino from "pino";
import { ConfigStore } from "@infra/config-store";

interface LoggingConfig {
  level?: pino.LevelWithSilent;
  directory?: string;
  max_file_size_mb?: number;
  max_days?: number;
}

const DEFAULT_CONFIG: Required<LoggingConfig> = {
  level: "info",
  directory: "logs",
  max_file_size_mb: 10,
  max_days: 30,
};

function loadConfig(repoRoot: string): Required<LoggingConfig> {
  const userConfig = new ConfigStore(repoRoot).readYaml<LoggingConfig>("logging.yaml") ?? {};
  return { ...DEFAULT_CONFIG, ...userConfig };
}

function buildFileTarget(config: Required<LoggingConfig>): pino.TransportTargetOptions {
  const logDir = path.resolve(config.directory);
  const logFile = path.join(logDir, "snail-shell.log");

  return {
    target: "pino-roll",
    options: {
      file: logFile,
      size: `${config.max_file_size_mb}m`,
      frequency: "daily",
      mkdir: true,
      limit: { count: config.max_days },
      dateFormat: "yyyy-MM-dd",
    },
    level: config.level,
  };
}

/** 前端日志专用 logger，写入 logs/web.log（独立于 snail-shell.log） */
let webLogger: pino.Logger | null = null;

export function getWebLogger(): pino.Logger {
  if (!webLogger) {
    const repoRoot = process.cwd();
    const config = loadConfig(repoRoot);
    const logFile = path.resolve(config.directory, "web.log");

    const transport = pino.transport({
      targets: [
        {
          target: "pino-roll",
          options: {
            file: logFile,
            size: `${config.max_file_size_mb}m`,
            frequency: "daily",
            mkdir: true,
            limit: { count: config.max_days },
            dateFormat: "yyyy-MM-dd",
          },
          level: "info",
        },
        {
          target: "pino/file",
          options: { destination: 1 },
          level: "info",
        },
      ],
    });

    webLogger = pino({ level: "info" }, transport);
  }
  return webLogger;
}

let rootLogger: pino.Logger | null = null;

export function getLogger(context?: Record<string, unknown>): pino.Logger {
  if (!rootLogger) {
    rootLogger = initRootLogger();
  }

  return context ? rootLogger.child(context) : rootLogger;
}

function initRootLogger(): pino.Logger {
  const repoRoot = process.cwd();
  const config = loadConfig(repoRoot);

  const transport = pino.transport({
    targets: [
      buildFileTarget(config),
      {
        target: "pino/file",
        options: { destination: 1 },
        level: config.level,
      },
    ],
  });

  return pino(
    {
      level: config.level,
      serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err,
      },
    },
    transport,
  );
}
