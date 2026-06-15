import { serve } from "@hono/node-server";
import { FileDataStore } from "@infra/file-data-store";
import { ConfigStore } from "@infra/config-store";
import { loadServerSettings, type ServerSettings } from "@infra/server-config";
import { SQLiteDatabase } from "@infra/database";
import { createApp } from "@infra/http/app";
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
import { init as initMCP } from "@domain/mcp/_internal/initor";
import { init as initIssueCollaboration } from "@app/issue-collaboration/initor";
import { init as initIMHub } from "@app/im-hub/initor";
import { createMcpHandler } from "@infra/mcp-server/handler";

async function main() {
  const repoRoot = process.cwd();
  const serverSettings = loadServerSettings(repoRoot);
  const modules = await initModules(repoRoot, serverSettings);

  modules.featureChain.adapter.rebuild();
  logStartupSummary(modules);
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
  const knowledge = initKnowledge(dataStore, workspaces);
  const issue = initIssue(sop.adapter);
  const message = initMessage();
  const evolution = initEvolution(issue.issueAdapter);
  const snailMCPServer = initMCPServer({ updateEvolution: (id, updates) => Promise.resolve(evolution.adapter.update(id, updates)), knowledge: knowledge.adapter, message: message.adapter });
  const mcp = initMCP({ dataStore, workspaces, snailMCPServer: snailMCPServer.adapter, serverSettings });
  const featureChain = initFeatureChain(repoRoot);
  const guardProfile = initGuardProfile(dataStore);
  const liteAI = initLiteAI(dataStore);
  const snail = initSnail(dataStore, { registry, tenetPrompt: tenetPrompt.adapter, skill: skill.adapter, mcp: mcp.adapter, guardProfile: guardProfile.adapter });
  const collaboration = initIssueCollaboration({ issuePort: issue.issueAdapter, stagePort: issue.stageAdapter, messagePort: message.adapter, snailPort: snail.adapter, liteAIPort: liteAI.adapter });
  const im = initIM({ workspacePort: workspace.adapter, issuePort: issue.issueAdapter, stagePort: issue.stageAdapter, configStore, db });
  const imHub = initIMHub({ imAdapter: im.adapter, lobbyAdapter: im.lobbyAdapter, collaboration: collaboration.adapter });
  await im.adapter.startChannels();
  return { registry, workspace, tenetPrompt, skill, sop, snailMCPServer, mcp, featureChain, snail, im, imHub, liteAI, evolution, issue, message, collaboration, knowledge, configStore };
}

function logStartupSummary(modules: Awaited<ReturnType<typeof initModules>>): void {
  console.log(`Loaded ${modules.workspace.adapter.list().length} workspaces`);
  console.log(`Loaded ${modules.tenetPrompt.adapter.list().length} prompts`);
  console.log(`Loaded ${modules.skill.adapter.list().length} skills`);
  console.log(`Loaded ${modules.sop.adapter.list().length} SOPs`);
  console.log(`MCP Servers: ${modules.snailMCPServer.adapter.listServers().map(s => s.name).join(", ")}`);
  console.log(`MCP Configs: ${modules.mcp.adapter.list().map(c => c.name).join(", ")}`);
  console.log(`Feature Chain: ${modules.featureChain.adapter.search("").length} docs indexed`);
  console.log(`Snails: ${modules.snail.adapter.list().map(s => s.key).join(", ")}`);
  console.log(`IM: ready (${modules.im.adapter.listChannelConfigs().map(c => c.type).join(", ") || "no channels"})`);
  console.log(`IM Hub: ready (${Boolean(modules.imHub.adapter)})`);
  console.log(`Lite AI: ${modules.liteAI.adapter.getConfig() ? "configured" : "not configured"}`);
  console.log(`Evolution: ready`);
  console.log(`Registered agents: ${modules.registry.listAgentRuntimes().join(", ")}`);
}

function startHttpServer(modules: Awaited<ReturnType<typeof initModules>>, serverSettings: ServerSettings): void {
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
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`HTTP server listening on http://localhost:${info.port}`);
  });
}


main().catch((err) => {
  console.error("Failed to start", err);
  process.exit(1);
});
