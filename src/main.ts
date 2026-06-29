import { serve } from "@hono/node-server";
import { FileDataStore } from "@infra/file-data-store";
import { ConfigStore } from "@infra/config-store";
import { loadServerSettings, type ServerSettings } from "@infra/server-config";
import { SQLiteDatabase } from "@infra/database";
import { createApp } from "@infra/http/app";
import { getLogger } from "@infra/logger";
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
import { init as initFeatureChain } from "@domain/feature-chain/_internal/initor";
import { init as initGuardProfile } from "@domain/guard-profile/_internal/initor";
import { init as initSnail } from "@domain/snail/_internal/initor";
import { init as initLiteAI } from "@domain/lite-ai/_internal/initor";
import { init as initMCP } from "@domain/mcp-config/_internal/initor";
import { init as initIssueCollaboration } from "@app/issue-collaboration/initor";
import { init as initIMHub } from "@app/im-hub/initor";
import { createMcpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import { createMcpHandler } from "@infra/mcp-server/handler";
import { createUnifiedWebSocketBridge } from "@infra/http/unified-websocket";

const log = getLogger();

async function main() {
  const repoRoot = process.cwd();
  const serverSettings = loadServerSettings(repoRoot);
  const { modules, db } = await initModules(repoRoot, serverSettings);

  modules.featureChain.adapter.rebuild();
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
  const featureChain = initFeatureChain(repoRoot);
  const evolutionRef: { current?: ReturnType<typeof initEvolution> } = {};
  const mcpMessageStore = createMcpMessageStore();
  const snailMCPServer = initMCPServer({
    updateEvolution: (id, updates) => {
      if (!evolutionRef.current) throw new Error("Evolution module is not initialized");
      return Promise.resolve(evolutionRef.current.adapter.update(id, updates));
    },
    knowledge: knowledge.adapter,
    message: message.adapter,
    issue: issue.issueAdapter,
    stage: issue.stageAdapter,
    featureChain: featureChain.adapter,
    mcpMessageStore,
  });
  const mcp = initMCP({ dataStore, workspaces, snailMCPServer: snailMCPServer.adapter, serverSettings });
  const guardProfile = initGuardProfile(dataStore);
  const liteAI = initLiteAI(dataStore);
  const snail = initSnail(dataStore, db, { registry, tenetPrompt: tenetPrompt.adapter, skill: skill.adapter, mcp: mcp.adapter, guardProfile: guardProfile.adapter }, serverSettings.maxConcurrentAgents);
  const collaboration = initIssueCollaboration({ issuePort: issue.issueAdapter, createIssue: (input) => issue.issueAdapter.createIssue(input), stagePort: issue.stageAdapter, messagePort: message.adapter, snailPort: snail.adapter, liteAIPort: liteAI.adapter, mcpMessageStore });
  const evolution = initEvolution(db, issue.issueAdapter, snail.adapter, collaboration.adapter);
  evolutionRef.current = evolution;
  const im = initIM({ workspacePort: workspace.adapter, issuePort: issue.issueAdapter, stagePort: issue.stageAdapter, configStore, db });
  const imHub = initIMHub({ imAdapter: im.adapter, lobbyAdapter: im.lobbyAdapter, collaboration: collaboration.adapter, stagePort: issue.stageAdapter });
  await im.adapter.startChannels();
  return { modules: { registry, workspace, tenetPrompt, skill, sop, snailMCPServer, mcp, featureChain, snail, im, imHub, liteAI, evolution, issue, message, collaboration, knowledge, configStore }, db };
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

/** 事件循环延迟监控：每 10s 检测一次，超过 200ms 告警 */
function startEventLoopMonitor(): void {
  let lastCheck = process.hrtime.bigint();
  setInterval(() => {
    const now = process.hrtime.bigint();
    const elapsedMs = Number(now - lastCheck) / 1e6;
    const delayMs = Math.max(0, elapsedMs - 10_000);
    lastCheck = now;
    if (delayMs > 200) {
      log.warn({ delayMs: Math.round(delayMs) }, "event_loop.blocked");
    }
  }, 10_000).unref();
}

function startHttpServer(modules: Awaited<ReturnType<typeof initModules>>["modules"], serverSettings: ServerSettings): void {
  startEventLoopMonitor();
  const mcpHandler = createMcpHandler(modules.snailMCPServer.adapter);
  const app = createApp({
    workspaceAdapter: modules.workspace.adapter,
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
