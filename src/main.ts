import express from "express";
import path from "path";
import { ConversationStore } from "./persistence/store";
import { ClaudeCodeAgent } from "./agent/claude-code";
import { SessionManager } from "./session/manager";
import { createServer } from "./api/server";
import { SkillRegistry } from "./skills";
import { SnailRegistry } from "./snails";
import { logger } from "./logger";

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db");

const store = new ConversationStore(DB_PATH);
const agent = new ClaudeCodeAgent();
const skillRegistry = new SkillRegistry();
const snailRegistry = new SnailRegistry();
const sessionManager = new SessionManager(store, agent, skillRegistry, snailRegistry);

const { app, server } = createServer(sessionManager);

app.use(express.static(path.join(__dirname, "web")));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", agent: agent.name });
});

server.listen(PORT, () => {
  logger.info("Server started", { port: PORT, agent: agent.name, database: DB_PATH });
  console.log(`snail-shell is running on http://localhost:${PORT}`);
});

function shutdown() {
  logger.info("Server shutting down");
  console.log("\nshutting down...");
  server.close();
  store.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
