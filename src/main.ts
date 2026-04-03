import express from "express";
import path from "path";
import fs from "fs";
import { ConversationStore } from "./persistence/store";
import { ClaudeCodeAgent } from "./agent/claude-code";
import { SessionManager } from "./session/manager";
import { createServer } from "./api/server";
import { SkillRegistry } from "./skills";

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db");
const LOG_PATH = path.join(process.cwd(), "data", "snail-shell.log");

// Create log file stream
const logStream = fs.createWriteStream(LOG_PATH, { flags: "a" });

export function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  logStream.write(logMessage, (err) => {
    if (err) console.error("Failed to write log:", err);
  });
  // Force flush for immediate visibility
  if (logStream.writableNeedDrain) {
    logStream.once('drain', () => {});
  }
}

const store = new ConversationStore(DB_PATH);
const agent = new ClaudeCodeAgent();
const skillRegistry = new SkillRegistry();
const sessionManager = new SessionManager(store, agent, skillRegistry);

const { app, server } = createServer(sessionManager);

app.use(express.static(path.join(__dirname, "web")));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", agent: agent.name });
});

server.listen(PORT, () => {
  console.log(`snail-shell is running on http://localhost:${PORT}`);
  console.log(`agent: ${agent.name}`);
  console.log(`database: ${DB_PATH}`);
});

function shutdown() {
  console.log("\nshutting down...");
  server.close();
  store.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
