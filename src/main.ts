import express from "express";
import path from "path";
import { ConversationStore } from "./persistence/store";
import { ClaudeCodeAgent } from "./agent/claude-code";
import { OpenCodeAgent } from "./agent/opencode";
import { GeminiAgent } from "./agent/gemini";
import { CodexAgent } from "./agent/codex";
import { RuntimeSnailAgentResolver } from "./agent/resolver";
import type { SnailRuntime } from "./agent/interface";
import { loadLlmConfig, OpenAIClient, OpenAIConversationSummaryGenerator, OpenAIMentionExtractor } from "./llm";
import { ProjectManager } from "./project/manager";
import { createServer } from "./api/server";
import { SnailRegistry } from "./snails";
import { logger } from "./logger";
import { seedSelfProject } from "./project/self-project-seed";

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db");

async function initializeAgents(): Promise<SnailRuntime[]> {
  const agents: SnailRuntime[] = [
    new ClaudeCodeAgent(),
    new OpenCodeAgent(),
    new CodexAgent(),
  ];

  const geminiAgent = new GeminiAgent();
  const isGeminiAvailable = await geminiAgent.checkCLI();
  if (isGeminiAvailable) {
    agents.push(geminiAgent);
    logger.info("Gemini CLI agent registered");
  } else {
    logger.warn("Gemini CLI not available, skipping registration");
  }

  return agents;
}

function registerHealthRoute(app: express.Express, agentResolver: RuntimeSnailAgentResolver): void {
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", agents: agentResolver.list().map((agent) => agent.name) });
  });
}

function registerServerDiagnostics(server: ReturnType<typeof createServer>["server"]): void {
  server.on("error", (error) => {
    logger.error("HTTP server error", { error });
  });

  server.on("close", () => {
    logger.info("HTTP server closed");
  });
}

function registerProcessDiagnostics(): void {
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", { error });
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", { reason });
  });
}

function registerShutdownHandlers(server: ReturnType<typeof createServer>["server"], store: ConversationStore): void {
  function shutdown(signal: NodeJS.Signals) {
    logger.info("Shutdown signal received", { signal });
    server.close(() => {
      logger.info("Server shutdown complete");
      store.close();
      process.exit(0);
    });
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function createOpenAIClient(llmConfig: ReturnType<typeof loadLlmConfig>): OpenAIClient {
  return new OpenAIClient({
    apiKey: llmConfig.openai.api_key,
    model: llmConfig.openai.model,
    baseUrl: llmConfig.openai.base_url,
    timeoutMs: llmConfig.openai.timeout_ms,
  });
}

function createProjectManager(
  store: ConversationStore,
  agentResolver: RuntimeSnailAgentResolver,
  snailRegistry: SnailRegistry,
  llmConfig: ReturnType<typeof loadLlmConfig>
): ProjectManager {
  const openAIClient = createOpenAIClient(llmConfig);
  const summaryGenerator = new OpenAIConversationSummaryGenerator(openAIClient);
  const mentionExtractor = new OpenAIMentionExtractor(openAIClient);
  return new ProjectManager(store, agentResolver, snailRegistry, summaryGenerator, mentionExtractor);
}

async function main() {
  const store = new ConversationStore(DB_PATH);
  const llmConfig = loadLlmConfig();

  if (llmConfig.provider !== "openai") {
    throw new Error(`Unsupported llm provider: ${llmConfig.provider}`);
  }

  if (!llmConfig.openai.api_key) {
    throw new Error("config/llm.json openai.api_key is required for conversation summary generation");
  }

  logger.info("Server initialization started", { port: PORT, database: DB_PATH });
  const agents = await initializeAgents();
  const agentResolver = new RuntimeSnailAgentResolver(agents);
  const snailRegistry = new SnailRegistry();
  const seedResult = seedSelfProject(store, snailRegistry);
  logger.info(seedResult.created ? "Default self project created" : "Default self project already exists", {
    projectId: seedResult.project.id,
    stageId: seedResult.stage?.id,
    conversationId: seedResult.conversation?.id,
  });
  const projectManager = createProjectManager(store, agentResolver, snailRegistry, llmConfig);

  const { app, server } = createServer(projectManager);

  app.use(express.static(path.join(__dirname, "web")));
  registerHealthRoute(app, agentResolver);
  registerServerDiagnostics(server);
  registerShutdownHandlers(server, store);

  logger.info("Starting HTTP server", { port: PORT });
  server.listen(PORT, () => {
    logger.info("Server started", { port: PORT, agents: agentResolver.list().map((agent) => agent.name), database: DB_PATH });
  });
}

registerProcessDiagnostics();

void main().catch((error) => {
  logger.error("Failed to start server", { error });
  process.exit(1);
});
