import { serve } from "@hono/node-server";
import { FileDataStore } from "@infra/file-data-store";
import { ConfigStore } from "@infra/config-store";
import { loadServerSettings, type ServerSettings } from "@infra/server-config";
import { SQLiteDatabase } from "@infra/database";
import { createApp } from "@adapter/http/app";
import { getLogger } from "@infra/logger";
import blocked from "blocked-at";
import { init as initAcs } from "@infra/acs/_internal/initor";
import { init as initWorkspace } from "@domain/workspace/_internal/initor";
import { init as initTenetPrompt } from "@domain/tenet-prompt/_internal/initor";
import { init as initSkill } from "@domain/skill/_internal/initor";
import { init as initSop } from "@domain/sop/_internal/initor";
import { init as initMCPServer } from "@domain/snail-mcp-server/_internal/initor";
import { initHono as initIM } from "@domain/im/_internal/hono-initor";
import { init as initKnowledge } from "@domain/knowledge/_internal/initor";
import { init as initIssue } from "@domain/issue/_internal/initor";
import { init as initMessage } from "@domain/message/_internal/initor";
import { init as initEvolution } from "@domain/evolution/_internal/initor";
import { init as initEvolutionApp } from "@app/evolution/initor";
import { init as initFeatureChain } from "@domain/feature-chain/_internal/initor";
import { init as initGuardProfile } from "@domain/guard-profile/_internal/initor";
import { init as initSnail } from "@domain/snail/_internal/initor";
import { init as initLiteAI } from "@domain/lite-ai/_internal/initor";
import { init as initMCP } from "@domain/mcp-config/_internal/initor";
import { init as initIssueCollaboration } from "@app/issue-collaboration/initor";
import { init as initIMHub } from "@app/im-hub/initor";
import { createMcpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import { init as initMemorySearch } from "@domain/memory-search/_internal/initor";
import { KnowledgeSearchChannel } from "@domain/knowledge/_internal/search-channel";
import { MessageSearchChannel } from "@domain/message/_internal/search-index";
import { FeatureDocSearchChannel } from "@domain/feature-chain/_internal/search-index";
import { EvolutionSearchChannel } from "@domain/evolution/_internal/search-index";
import type { StageTransitionPort, IssueManagementPort } from "@domain/snail-mcp-server/port";
import { createMcpHandler } from "@adapter/mcp-server/handler";
import { createUnifiedWebSocketBridge } from "@adapter/http/unified-websocket";

const log = getLogger();

async function main() {
  const repoRoot = process.cwd();
  const serverSettings = loadServerSettings(repoRoot);
  const { modules, db } = await initModules(repoRoot, serverSettings);

  logStartupSummary(modules);
  registerShutdownHooks(modules, db);
  startHttpServer(modules, serverSettings);
}

async function initModules(repoRoot: string, serverSettings: ServerSettings) {
  const db = new SQLiteDatabase(repoRoot);
  const dataStore = FileDataStore.fromRepoRoot(repoRoot);
  const configStore = new ConfigStore(repoRoot);
  const { registry } = await initAcs();
  const workspace = initWorkspace(dataStore);
  const workspaces = workspace.adapter.list();
  const tenetPrompt = initTenetPrompt(dataStore, workspaces);
  const skill = initSkill(dataStore, workspaces);
  const sop = initSop(dataStore, workspaces);
  const knowledge = initKnowledge(dataStore, workspaces, db);
  const issue = initIssue(sop.adapter, db);
  const message = initMessage(db);
  const featureChain = initFeatureChain(repoRoot, db);
  const evolution = initEvolution(db);

  // 创建跨域统一搜索协调器
  const memorySearch = initMemorySearch([
    new KnowledgeSearchChannel(knowledge.index),
    new MessageSearchChannel(message.searchIndex),
    new FeatureDocSearchChannel(featureChain.searchIndex),
    new EvolutionSearchChannel(evolution.searchIndex),
  ]);

  const mcpMessageStore = createMcpMessageStore();
  /** lazy proxy for StageTransitionPort — collaboration 在 MCP server 之后初始化 */
  const collaborationRef: { current?: { requestTransition: StageTransitionPort["requestTransition"]; spawnIssue: IssueManagementPort["spawnIssue"] } } = {};
  const lazyStageTransition: StageTransitionPort = {
    requestTransition: async (input) => {
      if (!collaborationRef.current) throw new Error("Collaboration module is not initialized");
      return collaborationRef.current.requestTransition(input);
    },
  };
  /** lazy proxy for IssueManagementPort — 同样依赖 collaboration */
  const lazyIssueManagement: IssueManagementPort = {
    spawnIssue: async (input) => {
      if (!collaborationRef.current) throw new Error("Collaboration module is not initialized");
      return collaborationRef.current.spawnIssue(input);
    },
  };
  const snailMCPServer = initMCPServer({
    evolution: evolution.adapter,
    knowledge: knowledge.adapter,
    message: message.adapter,
    issue: issue.issueAdapter,
    stage: issue.stageAdapter,
    featureChain: featureChain.adapter,
    mcpMessageStore,
    stageTransition: lazyStageTransition,
    memorySearch: memorySearch.adapter,
    issueManagement: lazyIssueManagement,
  });
  const mcp = initMCP({ dataStore, workspaces, snailMCPServer: snailMCPServer.adapter, serverSettings });
  const guardProfile = initGuardProfile(dataStore);
  const liteAI = initLiteAI(dataStore);
  const snail = initSnail(dataStore, db, { registry, tenetPrompt: tenetPrompt.adapter, skill: skill.adapter, mcp: mcp.adapter, guardProfile: guardProfile.adapter }, serverSettings.maxConcurrentAgents);
  const collaboration = initIssueCollaboration({ issuePort: issue.issueAdapter, createIssue: (input) => issue.issueAdapter.createIssue(input), stagePort: issue.stageAdapter, messagePort: message.adapter, snailPort: snail.adapter, liteAIPort: liteAI.adapter, mcpMessageStore, stageSuggestionRepo: issue.stageSuggestionRepo });
  collaborationRef.current = collaboration.adapter;
  const evolutionApp = initEvolutionApp({
    evolutionPort: evolution.adapter,
    collaboration: collaboration.adapter,
    issuePort: issue.issueAdapter,
    snailPort: snail.adapter,
  });
  const im = initIM({ workspacePort: workspace.adapter, issuePort: issue.issueAdapter, stagePort: issue.stageAdapter, configStore, db });
  const imHub = initIMHub({ imAdapter: im.adapter, lobbyAdapter: im.lobbyAdapter, collaboration: collaboration.adapter, stagePort: issue.stageAdapter });
  await im.adapter.startChannels();
  return { modules: { registry, workspace, tenetPrompt, skill, sop, snailMCPServer, mcp, featureChain, snail, im, imHub, liteAI, evolution, evolutionApp, issue, message, collaboration, knowledge, memorySearch, configStore }, db };
}

function logStartupSummary(modules: Awaited<ReturnType<typeof initModules>>["modules"]): void {
  log.info({ count: modules.workspace.adapter.list().length }, "Loaded workspaces");
  log.info({ count: modules.tenetPrompt.adapter.list().length }, "Loaded prompts");
  log.info({ count: modules.skill.adapter.list().length }, "Loaded skills");
  log.info({ count: modules.sop.adapter.list().length }, "Loaded SOPs");
  log.info({ names: modules.snailMCPServer.adapter.listServers().map(s => s.name) }, "MCP Servers");
  log.info({ names: modules.mcp.adapter.list().map(c => c.name) }, "MCP Configs");
  log.info({ docsIndexed: modules.featureChain.adapter.search("").length }, "Feature Chain");
  log.info({ keys: modules.snail.adapter.list().map(s => s.key) }, "Snails");
  log.info({ channels: modules.im.adapter.listChannelConfigs().map(c => c.type) || "none" }, "IM");
  log.info({ ready: Boolean(modules.imHub.adapter) }, "IM Hub");
  log.info({ status: modules.liteAI.adapter.getConfig() ? "configured" : "not configured" }, "Lite AI");
  log.info({ status: "ready" }, "Evolution");
  log.info({ status: "ready" }, "Memory Search");
  log.info({ names: modules.registry.listAgentRuntimes() }, "Registered agents");
}

function registerShutdownHooks(modules: Awaited<ReturnType<typeof initModules>>["modules"], db: SQLiteDatabase): void {
  let closed = false;
  const shutdown = () => {
    if (closed) return;
    closed = true;
    log.info("Closing database...");
    db.close();
  };
  process.on("exit", shutdown);
  process.on("SIGINT", () => { shutdown(); process.exit(0); });
  process.on("SIGTERM", () => { shutdown(); process.exit(0); });
}

/**
 * 事件循环阻塞监控：使用 blocked-at 自动捕获阻塞源调用栈。
 * 默认启用，通过 BLOCKED_AT_ENABLED=false 显式关闭。
 * 超过 5 秒的阻塞记录完整调用栈（截断到前 20 帧）。
 */
export function startEventLoopMonitor(): void {
  if (process.env.BLOCKED_AT_ENABLED === "false") {
    log.info("event_loop.blocked_at disabled by BLOCKED_AT_ENABLED=false");
    return;
  }

  const MAX_STACK_FRAMES = 20;
  const cleanup = blocked((time, stack) => {
    if (time > 5_000) {
      /** 截断调用栈到前 MAX_STACK_FRAMES 帧，避免日志过大 */
      const truncatedStack = stack
        .split("\n")
        .slice(0, MAX_STACK_FRAMES)
        .join("\n");
      log.warn({ delayMs: Math.round(time), stack: truncatedStack }, "event_loop.blocked_at");
    }
  }, { threshold: 5_000 });

  process.on("exit", () => cleanup());
}

function startHttpServer(modules: Awaited<ReturnType<typeof initModules>>["modules"], serverSettings: ServerSettings): void {
  startEventLoopMonitor();
  const mcpHandler = createMcpHandler(modules.snailMCPServer.adapter);
  const app = createApp({
    workspacePort: modules.workspace.adapter,
    issuePort: modules.issue.issueAdapter,
    stagePort: modules.issue.stageAdapter,
    messagePort: modules.message.adapter,
    collaboration: modules.collaboration.adapter,
    tenetPrompt: modules.tenetPrompt.adapter,
    skill: modules.skill.adapter,
    sop: modules.sop.adapter,
    snail: modules.snail.adapter,
    mcp: modules.mcp.adapter,
    knowledge: modules.knowledge.adapter,
    evolution: modules.evolution.adapter,
    evolutionApp: modules.evolutionApp.adapter,
    mcpHandler,
  });
  app.route("/im", modules.im.app);
  const port = serverSettings.port;
  const wsBridge = createUnifiedWebSocketBridge(modules.collaboration.adapter);
  app.get("/issue-events", wsBridge.route);
  app.get("/workspace-events", wsBridge.route);
  serve({ fetch: app.fetch, port, websocket: { server: wsBridge.server } }, (info) => {
    log.info({ port: info.port }, "HTTP server listening");
  });
}


main().catch((err) => {
  log.error({ err }, "Failed to start");
  process.exit(1);
});
