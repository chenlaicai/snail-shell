import { serve } from "@hono/node-server";
import { FileDataStore } from "@infra/file-data-store";
import { SQLiteDatabase } from "@infra/database";
import { createApp } from "@infra/http/app";
import { init as initAcs } from "@domain/acs/_internal/initor";
import { init as initWorkspace } from "@domain/workspace/_internal/initor";
import { init as initTenetPrompt } from "@domain/tenet-prompt/_internal/initor";
import { init as initSkill } from "@domain/skill/_internal/initor";
import { init as initSop } from "@domain/sop/_internal/initor";
import { init as initMCP } from "@domain/mcp/_internal/initor";
import { init as initMCPServer } from "@domain/snail-mcp-server/_internal/initor";
import { initHono as initIM } from "@domain/im/_internal/hono-initor";
import { init as initKnowledge } from "@domain/knowledge/_internal/initor";
import { init as initKnowledgeMCP } from "@domain/knowledge-mcp/_internal/initor";
import { init as initIssue } from "@domain/issue/_internal/initor";
import { init as initStage } from "@domain/stage/_internal/initor";
import { init as initEvolution } from "@domain/evolution/_internal/initor";
import { initGovernance as initEvolutionGovernance } from "@app/evolution-governance/governance";
import { init as initFeatureChain } from "@domain/feature-chain/_internal/initor";
import { init as initGuardProfile } from "@domain/guard-profile/_internal/initor";
import { init as initSnail } from "@domain/snail/_internal/initor";
import { init as initLiteAI } from "@domain/lite-ai/_internal/initor";
import { createMcpHandler } from "@infra/mcp-server/handler";

async function main() {
  const repoRoot = process.cwd();

  // 基础设施
  const db = new SQLiteDatabase(repoRoot);
  const dataStore = new FileDataStore(repoRoot);

  // 初始化 acs（agent 运行时）
  const { registry } = await initAcs();

  // 初始化 workspace
  const workspace = initWorkspace(dataStore);
  const workspaces = workspace.repo.list();

  // 初始化领域模块
  const tenetPrompt = initTenetPrompt(dataStore, workspaces);
  const skill = initSkill(dataStore, workspaces);
  const sop = initSop(dataStore, workspaces);
  const mcp = initMCP(dataStore, workspaces);
  const im = initIM();
  const knowledge = initKnowledge(dataStore, workspaces);
  const knowledgeMCP = initKnowledgeMCP(knowledge.adapter);
  const issue = initIssue(sop.adapter);
  const stage = initStage();
  const evolution = initEvolution();
  const evolutionGovernance = initEvolutionGovernance(evolution.adapter, issue.adapter, stage.adapter, sop.adapter);

  // 初始化 snail-mcp-server（注册所有 MCP Server）
  const snailMCPServer = initMCPServer({
    evolutionUpdateStatus: (id, status, result) =>
      Promise.resolve(evolution.adapter.updateStatus(id, status, result)),
    knowledge: knowledgeMCP.adapter,
  });

  const featureChain = initFeatureChain(repoRoot);
  const guardProfile = initGuardProfile(dataStore);
  const liteAI = initLiteAI(dataStore);

  // 初始化 snail（依赖 tenet-prompt, skill, mcp, guard-profile, acs registry）
  const snail = initSnail(dataStore, {
    registry,
    tenetPrompt: tenetPrompt.adapter,
    skill: skill.adapter,
    mcp: mcp.adapter,
    guardProfile: guardProfile.adapter,
  });

  // 重建 Feature Chain 索引
  featureChain.adapter.rebuild();

  // 输出加载结果
  console.log(`Loaded ${workspace.adapter.list().length} workspaces`);
  console.log(`Loaded ${tenetPrompt.adapter.list().length} prompts`);
  console.log(`Loaded ${skill.adapter.list().length} skills`);
  console.log(`Loaded ${sop.adapter.list().length} SOPs`);
  console.log(`MCP Servers: ${snailMCPServer.adapter.listServers().map(s => s.name).join(", ")}`);
  console.log(`Feature Chain: ${featureChain.adapter.search("").length} docs indexed`);
  console.log(`Snails: ${snail.adapter.list().map(s => s.id).join(", ")}`);
  console.log(`IM: ready`);
  console.log(`Lite AI: ${liteAI.repo.getConfig() ? "configured" : "not configured"}`);
  console.log(`Evolution: ready`);
  console.log(`Evolution Governance: ready`);
  console.log(`Registered agents: ${registry.listAgentRuntimes().join(", ")}`);

  // HTTP 服务
  const mcpHandler = createMcpHandler(snailMCPServer.adapter);
  const app = createApp({
    workspaceAdapter: workspace.adapter,
    mcpHandler,
  });

  const port = Number(process.env.PORT) || 3000;
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`HTTP server listening on http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start", err);
  process.exit(1);
});
