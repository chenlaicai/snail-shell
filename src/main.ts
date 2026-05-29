import fs from "fs";
import express from "express";
import path from "path";
import { ConversationStore } from "./persistence/store";
import { getSchemaVersion } from "./persistence/schema";
import { ClaudeCodeAgent } from "./agent/claude-code";
import { ClaudeCodeStatefulAgent } from "./agent/claude-code-stateful";
import { OpenCodeAgent } from "./agent/opencode";
import { CodexAgent } from "./agent/codex";
import { RuntimeSnailAgentResolver } from "./agent/resolver";
import type { SnailRuntime } from "./agent/interface";
import { loadLlmConfig, OpenAIClient } from "./llm";
import { SystemAISnail } from "./snail-den/system-ai";
import { ProjectManager } from "./project-workflow/manager";
import { createServer } from "./interaction-entry/api/server";
import { RoleRegistry } from "./roles";
import { SnailDen } from "./snail-den";
import { logger } from "./logger";
import { seedSelfProject } from "./project-workflow/self-project-seed";
import { ConversationGateway } from "./interaction-entry/gateway";
import { FeishuConversationChannel, FeishuSdkTransport, loadFeishuConfig } from "./interaction-entry/feishu";
import { LobbyAwareChannel } from "./interaction-entry/im-channel";
import { LobbySessionStore, LobbyRouter, LobbyCommandExecutor, PlainTextLobbyRenderer } from "./lobby";
import { mergeMcpJson } from "./agent/mcp-config";

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db");

async function initializeAgents(): Promise<SnailRuntime[]> {
	  const agents: SnailRuntime[] = [
	    new ClaudeCodeAgent(),
	    new ClaudeCodeStatefulAgent(),
	    new OpenCodeAgent(),
	    new CodexAgent(),
	  ];

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

function registerShutdownHandlers(server: ReturnType<typeof createServer>["server"], store: ConversationStore, shutdownTasks: Array<() => Promise<void> | void> = []): void {
  async function shutdown(signal: NodeJS.Signals) {
    logger.info("Shutdown signal received", { signal });
    server.close(async () => {
      logger.info("Server shutdown complete");
      for (const task of shutdownTasks) await task();
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
  deps: { roleRegistry: RoleRegistry; snailDen: SnailDen; llmConfig: ReturnType<typeof loadLlmConfig>; defaultSopKey?: string }
): ProjectManager {
  const openAIClient = createOpenAIClient(deps.llmConfig);
  const systemAI = new SystemAISnail(openAIClient);
  return new ProjectManager(store, agentResolver, { roleRegistry: deps.roleRegistry, systemAI, snailDen: deps.snailDen }, { defaultSopKey: deps.defaultSopKey });
}

async function startFeishuChannel(
  conversationGateway: ConversationGateway,
  projectManager: ProjectManager,
  store: ConversationStore,
): Promise<(() => Promise<void>) | null> {
  const feishuConfig = loadFeishuConfig();
  if (!feishuConfig.enabled) return null;
  const appId = process.env[feishuConfig.app_id_env];
  const appSecret = process.env[feishuConfig.app_secret_env];
  if (!appId || !appSecret) {
    throw new Error(`Feishu integration is enabled but ${feishuConfig.app_id_env}/${feishuConfig.app_secret_env} are not set`);
  }
  const transport = new FeishuSdkTransport({ appId, appSecret });

  /** 大厅模式优先：lobby_bindings 中的 chat 使用 LobbyAwareChannel */
  if (feishuConfig.lobby_enabled && feishuConfig.lobby_bindings.length > 0) {
    const sessionStore = new LobbySessionStore(store.getDb());
    const responseRenderer = new PlainTextLobbyRenderer();
    const commandExecutor = new LobbyCommandExecutor(projectManager, store, sessionStore, responseRenderer);
    const lobbyRouter = new LobbyRouter({ sessionStore, commandExecutor, responseRenderer, gateway: conversationGateway });
    const channel = new LobbyAwareChannel(
      { channelType: "feishu", maxTextLength: feishuConfig.message_push.max_text_length, includeUserMessages: feishuConfig.message_push.include_user_messages, lobbyBindings: feishuConfig.lobby_bindings },
      { transport, lobbyRouter, gateway: conversationGateway, responseRenderer },
    );
    await channel.start();
    return () => channel.stop();
  }

  /** 传统静态绑定模式 */
  const feishuChannel = new FeishuConversationChannel(feishuConfig, conversationGateway, transport);
  await feishuChannel.start();
  return () => feishuChannel.stop();
}

function loadSeed(): { defaultSopForNewProjects?: string; sops: any[]; projects: any[] } {
  const seedPath = path.join(process.cwd(), ".meta", "project-config-seed.json");
  const raw = fs.readFileSync(seedPath, "utf8").replace(/\{\{process\.cwd\(\)\}\}/g, process.cwd());
  return JSON.parse(raw);
}

async function createRuntimeContext(store: ConversationStore): Promise<{ agentResolver: RuntimeSnailAgentResolver; roleRegistry: RoleRegistry; snailDen: SnailDen; projectManager: ProjectManager }> {
  const llmConfig = loadLlmConfig();
  if (llmConfig.provider !== "openai") throw new Error(`Unsupported llm provider: ${llmConfig.provider}`);
  if (!llmConfig.openai.api_key) throw new Error("config/llm.json openai.api_key is required for conversation summary generation");
  const agents = await initializeAgents();
  const agentResolver = new RuntimeSnailAgentResolver(agents);
  const snailDen = new SnailDen(agentResolver);

  const seed = loadSeed();
  const seedResult = store.seedProjectConfigs(seed);
  logger.info(seedResult.created ? "Project configs seeded from file" : "Project configs already exist in DB");

  const roleRegistry = new RoleRegistry(store);
  const defaultSopKey = seed.defaultSopForNewProjects;

  const selfProjectResult = seedSelfProject(store, roleRegistry);
  logger.info("Self project ready", {
    projectId: selfProjectResult.project.id,
    stageId: selfProjectResult.stage?.id,
    conversationId: selfProjectResult.conversation?.id,
  });
  return { agentResolver, roleRegistry, snailDen, projectManager: createProjectManager(store, agentResolver, { roleRegistry, snailDen, llmConfig, defaultSopKey }) };
}

async function main() {
  const store = new ConversationStore(DB_PATH);
  logger.info("Server initialization started", { port: PORT, database: DB_PATH, schemaVersion: getSchemaVersion() });
  store.rebuildFeatureChainIndex();
  const { agentResolver, snailDen, projectManager } = await createRuntimeContext(store);
  await projectManager.waitForStartupRecovery();
  const conversationGateway = new ConversationGateway(projectManager);

  const lobbySessionStore = new LobbySessionStore(store.getDb());
  const { app, server } = createServer(projectManager, snailDen, store, conversationGateway, lobbySessionStore);
  const shutdownTasks: Array<() => Promise<void> | void> = [];
  const stopFeishuChannel = await startFeishuChannel(conversationGateway, projectManager, store);
  if (stopFeishuChannel) shutdownTasks.push(stopFeishuChannel);

  app.use(express.static(path.join(__dirname, "web")));
  registerHealthRoute(app, agentResolver);
  registerServerDiagnostics(server);
  registerShutdownHandlers(server, store, shutdownTasks);

  logger.info("Starting HTTP server", { port: PORT });
  server.listen(PORT, () => {
    // 安全写入 .mcp.json：读取已有配置，合并 Snail Shell 管理的 snail-final-body 条目，
    // 保留用户或项目已有的其他 MCP 服务器配置。
    mergeMcpJson(path.join(process.cwd(), ".mcp.json"), PORT);
    logger.info("Server started", { port: PORT, agents: agentResolver.list().map((agent) => agent.name), database: DB_PATH });
  });
}

registerProcessDiagnostics();

void main().catch((error) => {
  logger.error("Failed to start server", { error });
  process.exit(1);
});
