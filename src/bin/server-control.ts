#!/usr/bin/env node

import fs from "fs";
import http from "http";
import path from "path";
import { spawn } from "child_process";
import { getCurrentLogFilePath } from "../logger";

interface ParsedArgs {
  command: "start" | "stop" | "status";
  port: number;
  dbPath: string;
}

interface PidFileRecord {
  pid: number;
  port: number;
  dbPath: string;
  cwd: string;
  entry: string;
  logFile: string;
  startedAt: string;
}

const ROOT = process.cwd();
const DIST_MAIN = path.join(ROOT, "dist", "src", "main.js");
const PID_DIR = path.join(ROOT, "pids");

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case "start":
      await startServer(args);
      return;
    case "stop":
      await stopServer(args);
      return;
    case "status":
      await showStatus(args);
      return;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = (argv[0] ?? "") as ParsedArgs["command"];
  const port = getNumberFlag(argv, "--port") ?? (Number(process.env.PORT) || 3000);
  const dbPath = getStringFlag(argv, "--db-path") || process.env.DB_PATH || path.join(ROOT, "data", "snail-shell.db");

  if (!command || !["start", "stop", "status"].includes(command)) {
    throw new Error("Usage: server-control <start|stop|status> [--port <port>] [--db-path <path>]");
  }

  return { command, port, dbPath };
}

function getStringFlag(argv: string[], name: string): string {
  const index = argv.indexOf(name);
  if (index === -1 || index === argv.length - 1) {
    return "";
  }
  return argv[index + 1] ?? "";
}

function getNumberFlag(argv: string[], name: string): number | null {
  const raw = getStringFlag(argv, name);
  if (!raw) {
    return null;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function ensurePidDirectory(): void {
  if (!fs.existsSync(PID_DIR)) {
    fs.mkdirSync(PID_DIR, { recursive: true });
  }
}

function pidFilePath(port: number): string {
  ensurePidDirectory();
  return path.join(PID_DIR, `snail-shell-${port}.pid`);
}

function writeControlLog(logFile: string, message: string, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const serializedMeta = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  fs.appendFileSync(logFile, `[${timestamp}] [INFO] server-control ${message}${serializedMeta}\n`);
}

function readPidRecord(port: number): PidFileRecord | null {
  const filePath = pidFilePath(port);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as PidFileRecord;
}

function savePidRecord(record: PidFileRecord): void {
  fs.writeFileSync(pidFilePath(record.port), `${JSON.stringify(record, null, 2)}\n`);
}

function removePidRecord(port: number): void {
  const filePath = pidFilePath(port);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function getPortPids(port: number): Promise<number[]> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn("lsof", ["-tiTCP:" + String(port), "-sTCP:LISTEN"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      if (code === 1 && stderr.trim() === "") {
        resolve("");
        return;
      }
      reject(new Error(`failed to inspect port ${port}: ${stderr.trim() || `exit ${code}`}`));
    });
  });

  return Array.from(
    new Set(
      output
        .split(/\s+/)
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );
}

async function stopPid(pid: number, logFile?: string): Promise<void> {
  if (!isProcessAlive(pid)) {
    return;
  }

  if (logFile) {
    writeControlLog(logFile, "stopping server", { pid });
  }
  process.kill(pid, "SIGTERM");

  const stopped = await waitForExit(pid, 5000);
  if (!stopped) {
    if (logFile) {
      writeControlLog(logFile, "server did not stop after SIGTERM, sending SIGKILL", { pid });
    }
    process.kill(pid, "SIGKILL");
    await waitForExit(pid, 1000);
  }
}

async function startServer(args: ParsedArgs): Promise<void> {
  const existing = readPidRecord(args.port);
  if (existing && isProcessAlive(existing.pid)) {
    process.stdout.write(`snail-shell already running (pid=${existing.pid}, port=${existing.port})\n`);
    return;
  }
  if (existing) {
    removePidRecord(args.port);
  }

  if (!fs.existsSync(DIST_MAIN)) {
    throw new Error(`dist entry not found: ${DIST_MAIN}. Run npm run build first.`);
  }

  const logFile = getCurrentLogFilePath();
  writeControlLog(logFile, "starting server", { port: args.port, dbPath: args.dbPath });
  const output = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, [DIST_MAIN], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", output, output],
    env: {
      ...process.env,
      PORT: String(args.port),
      DB_PATH: args.dbPath,
    },
  });

  child.unref();

  const record: PidFileRecord = {
    pid: child.pid!,
    port: args.port,
    dbPath: args.dbPath,
    cwd: ROOT,
    entry: DIST_MAIN,
    logFile,
    startedAt: new Date().toISOString(),
  };
  savePidRecord(record);

  process.stdout.write(`snail-shell started in background (pid=${record.pid}, port=${record.port})\n`);
  process.stdout.write(`log file: ${record.logFile}\n`);
}

async function stopServer(args: ParsedArgs): Promise<void> {
  const record = readPidRecord(args.port);
  const pids = await getPortPids(args.port);

  if (pids.length === 0) {
    if (record) {
      removePidRecord(args.port);
      process.stdout.write(`stale pid file removed for port ${args.port}\n`);
      return;
    }

    process.stdout.write(`snail-shell is not running on port ${args.port}\n`);
    return;
  }

  for (const pid of pids) {
    await stopPid(pid, record?.pid === pid ? record.logFile : undefined);
  }

  if (record) {
    removePidRecord(args.port);
  }

  process.stdout.write(`snail-shell stopped (${pids.map((pid) => `pid=${pid}`).join(", ")}, port=${args.port})\n`);
}

async function showStatus(args: ParsedArgs): Promise<void> {
  const record = readPidRecord(args.port);
  if (!record) {
    process.stdout.write(`snail-shell is not running on port ${args.port}\n`);
    return;
  }

  if (!isProcessAlive(record.pid)) {
    removePidRecord(args.port);
    process.stdout.write(`snail-shell pid file is stale on port ${args.port}\n`);
    return;
  }

  const health = await checkHealth(record.port);
  process.stdout.write(`${JSON.stringify({
    running: true,
    healthy: health.ok,
    pid: record.pid,
    port: record.port,
    dbPath: record.dbPath,
    logFile: record.logFile,
    healthStatus: health.status,
  }, null, 2)}\n`);
}

function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (!isProcessAlive(pid)) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 200);
  });
}

function checkHealth(port: number): Promise<{ ok: boolean; status: number | null }> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
      res.resume();
      resolve({ ok: res.statusCode === 200, status: res.statusCode ?? null });
    });
    req.on("error", () => resolve({ ok: false, status: null }));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve({ ok: false, status: null });
    });
  });
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
