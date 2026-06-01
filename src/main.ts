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
import { WorkspaceManager } from "./workspace-workflow/manager";
import { createServer } from "./interaction-entry/api/server";
import { RoleRegistry } from "./roles";
import { SnailDen } from "./snail-den";
import { logger } from "./logger";
import { seedSelfWorkspace } from "./workspace-workflow/self-workspace-seed";
import { ConversationGateway } from "./interaction-entry/gateway";
import { FeishuSdkTransport, loadFeishuConfig } from "./interaction-entry/feishu";
import { LobbyAwareChannel } from "./interaction-entry/im-channel";
import { LobbySessionStore, LobbyRouter, LobbyCommandExecutor, PlainTextLobbyRenderer, type LobbySession } from "./lobby";
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

/** unhandledRejection 的 reason 可能是任意类型，按类型分别序列化以保留关键信息。 */
function serializeReason(reason: unknown): Record<string, unknown> {
  if (reason instanceof Error) {
    return { error: reason };
  }
  return { reason: reason === null ? "null" : typeof reason === "object" ? reason : String(reason) };
}

function registerProcessDiagnostics(): void {
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", { error });
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", serializeReason(reason));
  });
}

function registerShutdownHandlers(server: ReturnType<typeof createServer>["server"], store: ConversationStore, workspaceManager: WorkspaceManager, shutdownTasks: Array<() => Promise<void> | void> = []): void {
  async function shutdown(signal: NodeJS.Signals) {
    logger.info("Shutdown signal received", { signal });
    /**
     * 关闭顺序：markShuttingDown → wait → server.close → exit。
     * 1. markShuttingDown 设置标志（拒绝新 send 请求）并立即中断所有运行中的 agent。
     *    中断后 agent 开始清理，HTTP handler 的 await 逐步释放，活跃连接随之关闭。
     * 2. wait 等待所有 agent 子进程的 SIGINT → SIGTERM → SIGKILL 清理链路收敛。
     * 3. server.close 停止接受新连接并等待残余连接排空后执行回调。
     *    此时已无活跃 agent，回调可以立即触发。
     * 4. 执行 shutdown 任务、关闭数据库、退出进程。
     *
     * 为什么不能把 interrupt 放在 server.close 回调内：
     * server.close 会等待所有活跃 HTTP 连接关闭后才触发回调。REST send_message 等待
     * agent 跑完才返回，连接不会释放。interrupt 在回调内 → 回调不触发 → agent 不被中断
     * → 连接不释放 → 死锁。
     */
    workspaceManager.markShuttingDown();
    await workspaceManager.waitForAllAgentProcessesStopped();
    logger.info("All agent processes stopped");
    server.close(async () => {
      logger.info("HTTP server closed");
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

function createWorkspaceManager(
  store: ConversationStore,
  agentResolver: RuntimeSnailAgentResolver,
  deps: { roleRegistry: RoleRegistry; snailDen: SnailDen; llmConfig: ReturnType<typeof loadLlmConfig> }
): WorkspaceManager {
  const openAIClient = createOpenAIClient(deps.llmConfig);
  const systemAI = new SystemAISnail(openAIClient);
  return new WorkspaceManager(store, agentResolver, { roleRegistry: deps.roleRegistry, systemAI, snailDen: deps.snailDen });
}

async function startFeishuChannel(
  conversationGateway: ConversationGateway,
  workspaceManager: WorkspaceManager,
  store: ConversationStore,
): Promise<{ stop: () => Promise<void>; lobbyChannel: LobbyAwareChannel | null } | null> {
  const feishuConfig = loadFeishuConfig();
  if (!feishuConfig.enabled) return null;
  const appId = process.env[feishuConfig.app_id_env];
  const appSecret = process.env[feishuConfig.app_secret_env];
  if (!appId || !appSecret) {
    throw new Error(`Feishu integration is enabled but ${feishuConfig.app_id_env}/${feishuConfig.app_secret_env} are not set`);
  }
  const transport = new FeishuSdkTransport({ appId, appSecret });

  const sessionStore = new LobbySessionStore(store.getDb());
  const responseRenderer = new PlainTextLobbyRenderer();
  const commandExecutor = new LobbyCommandExecutor(workspaceManager, store, sessionStore, responseRenderer);
  const lobbyRouter = new LobbyRouter({ sessionStore, commandExecutor, responseRenderer, gateway: conversationGateway });
  const channel = new LobbyAwareChannel(
    { channelType: "feishu", maxTextLength: feishuConfig.message_push.max_text_length, allowedChats: feishuConfig.allowed_chats },
    { transport, lobbyRouter, gateway: conversationGateway, responseRenderer, sessionStore },
  );
  await channel.start();
  return { stop: () => channel.stop(), lobbyChannel: channel };
}

function loadSeed(): { workspaces: any[] } {
  const seedPath = path.join(process.cwd(), ".meta", "workspace-config-seed.json");
  const raw = fs.readFileSync(seedPath, "utf8").replace(/\{\{process\.cwd\(\)\}\}/g, process.cwd());
  return JSON.parse(raw);
}

async function createRuntimeContext(store: ConversationStore): Promise<{ agentResolver: RuntimeSnailAgentResolver; roleRegistry: RoleRegistry; snailDen: SnailDen; workspaceManager: WorkspaceManager }> {
  const llmConfig = loadLlmConfig();
  if (llmConfig.provider !== "openai") throw new Error(`Unsupported llm provider: ${llmConfig.provider}`);
  if (!llmConfig.openai.api_key) throw new Error("config/llm.json openai.api_key is required for conversation summary generation");
  const agents = await initializeAgents();
  const agentResolver = new RuntimeSnailAgentResolver(agents);
  const snailDen = new SnailDen(agentResolver);

  /**
   * 启动加载顺序：
   * 1. 从 YAML 文件加载 SOP 定义（以 YAML 为准，覆盖更新数据库）
   * 2. 从 seed JSON 加载 workspace 定义和 SOP 绑定
   * 3. Seed self workspace
   *
   * Why: SOP 定义必须先于 workspace 绑定加载，因为 workspace_sop
   * 引用的 sop_id 必须已存在于 sop 表中。
   */
  const { loadAllSopFiles } = require("./persistence/sop-loader");
  const seed = loadSeed();

  /* 先加载 workspace 定义（但不创建绑定），获取 workspace_root 用于扫描 SOP 文件。
     由于 seed 中 workspace 的 workspace_root 可能包含 {{process.cwd()}} 模板，
     这里先做一次轻量解析来获取 root 路径。 */
  const parsedWorkspaces = seed.workspaces.map((ws: any) => ({
    id: ws.workspace.id,
    workspace_root: ws.workspace.workspace_root.replace(/\{\{process\.cwd\(\)\}\}/g, process.cwd()),
  }));
  const sopLoadResult = loadAllSopFiles(store.getDb(), process.cwd(), parsedWorkspaces);
  logger.info("SOP files loaded", { platform: sopLoadResult.platformLoaded, workspace: sopLoadResult.workspaceLoaded });

  const seedResult = store.seedWorkspaceConfigs(seed);
  logger.info(seedResult.created ? "Workspace configs seeded from file" : "Workspace configs already exist in DB");

  const roleRegistry = new RoleRegistry(store);

  const selfWorkspaceResult = seedSelfWorkspace(store, roleRegistry);
  logger.info("Self workspace ready", {
    workspaceId: selfWorkspaceResult.workspace.id,
    stageId: selfWorkspaceResult.stage?.id,
    conversationId: selfWorkspaceResult.conversation?.id,
  });
  return { agentResolver, roleRegistry, snailDen, workspaceManager: createWorkspaceManager(store, agentResolver, { roleRegistry, snailDen, llmConfig }) };
}

async function main() {
  const store = new ConversationStore(DB_PATH);
  logger.info("Server initialization started", { port: PORT, database: DB_PATH, schemaVersion: getSchemaVersion() });
  store.rebuildFeatureChainIndex();
  const { agentResolver, snailDen, workspaceManager } = await createRuntimeContext(store);
  await workspaceManager.waitForStartupRecovery();
  const conversationGateway = new ConversationGateway(workspaceManager);

  const lobbySessionStore = new LobbySessionStore(store.getDb());
  const shutdownTasks: Array<() => Promise<void> | void> = [];
  const feishuResult = await startFeishuChannel(conversationGateway, workspaceManager, store);
  if (feishuResult) shutdownTasks.push(feishuResult.stop);
  /** Web UI 重置/删除 session 时通知运行中通道清理出站订阅，避免向已退出会话推送 */
  const onLobbySessionCleanup = feishuResult?.lobbyChannel
    ? (session: LobbySession) => feishuResult.lobbyChannel!.cleanupSessionSubscriptions(session)
    : undefined;
  const { app, server } = createServer(workspaceManager, snailDen, store, conversationGateway, { sessionStore: lobbySessionStore, onSessionCleanup: onLobbySessionCleanup });

  app.use(express.static(path.join(__dirname, "web")));
  registerHealthRoute(app, agentResolver);
  registerServerDiagnostics(server);
  registerShutdownHandlers(server, store, workspaceManager, shutdownTasks);

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
