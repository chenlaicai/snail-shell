import express from "express";
import path from "path";
import { ConversationStore } from "./persistence/store";
import { ClaudeCodeAgent } from "./agent/claude-code";
import { OpenCodeAgent } from "./agent/opencode";
import { RuntimeSnailAgentResolver } from "./agent/resolver";
import { loadLlmConfig, OpenAIClient, OpenAIConversationSummaryGenerator } from "./llm";
import { ProjectManager } from "./project/manager";
import { createServer } from "./api/server";
import { SnailRegistry } from "./snails";
import { logger } from "./logger";

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db");

const store = new ConversationStore(DB_PATH);
const llmConfig = loadLlmConfig();
const agentResolver = new RuntimeSnailAgentResolver([
  new ClaudeCodeAgent(),
  new OpenCodeAgent(),
]);
const snailRegistry = new SnailRegistry();

if (llmConfig.provider !== "openai") {
  throw new Error(`Unsupported llm provider: ${llmConfig.provider}`);
}

if (!llmConfig.openai.api_key) {
  throw new Error("config/llm.json openai.api_key is required for conversation summary generation");
}

const summaryGenerator = new OpenAIConversationSummaryGenerator(new OpenAIClient({
  apiKey: llmConfig.openai.api_key,
  model: llmConfig.openai.model,
  baseUrl: llmConfig.openai.base_url,
  timeoutMs: llmConfig.openai.timeout_ms,
}));
const projectManager = new ProjectManager(store, agentResolver, snailRegistry, summaryGenerator);

const { app, server } = createServer(projectManager);

app.use(express.static(path.join(__dirname, "web")));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", agents: agentResolver.list().map((agent) => agent.name) });
});

server.listen(PORT, () => {
  logger.info("Server started", { port: PORT, agents: agentResolver.list().map((agent) => agent.name), database: DB_PATH });
});

function shutdown() {
  logger.info("Server shutting down");
  server.close();
  store.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
