import { FileSystem } from "@infra/file-system";
import { init as initWorkspace } from "@domain/workspace/_internal/initor";
import { init as initTenetPrompt } from "@domain/tenet-prompt/_internal/initor";
import { init as initSkill } from "@domain/skill/_internal/initor";
import { init as initSop } from "@domain/sop/_internal/initor";
import { init as initMCPServer } from "@domain/mcp-server/_internal/initor";
import { initHono as initIM } from "@domain/im/_internal/hono-initor";
import { init as initKnowledge } from "@domain/knowledge/_internal/initor";
import { init as initIssue } from "@domain/issue/_internal/initor";
import { init as initEvolution } from "@domain/evolution/_internal/adapter";
import { initGovernance as initEvolutionGovernance } from "@app/evolution-governance";
import { init as initFeatureChain } from "@domain/feature-chain/_internal/initor";
import { init as initSnail } from "@domain/snail/_internal/initor";
import { init as initLiteAI } from "@domain/lite-ai/_internal/initor";

async function main() {
  const repoRoot = process.cwd();
  const fs = new FileSystem();

  // 初始化各模块
  const workspace = initWorkspace(fs, repoRoot);
  const workspacePaths = workspace.repo.list().map(ws => ws.path);

  const tenetPrompt = initTenetPrompt(fs, repoRoot, workspacePaths);
  const skill = initSkill(fs, repoRoot, workspacePaths);
  const sop = initSop(fs, repoRoot);
  const mcpServer = initMCPServer();
  const im = initIM();
  const knowledge = initKnowledge();
  const issue = initIssue({ sopRepo: sop.repo, imRepo: im.repo });
  const evolution = initEvolution();
  const evolutionGovernance = initEvolutionGovernance(
    evolution.adapter,
    issue.adapter,
    im.adapter,
    sop.adapter,
  );
  const featureChain = initFeatureChain(fs, repoRoot);
  const snail = initSnail(fs, repoRoot);
  const liteAI = initLiteAI(fs, repoRoot);

  // 注册平台级 MCP Server
  mcpServer.adapter.registerPlatformServer({
    name: "snail-final-response",
    url: `http://localhost:3000/snail-final-response`,
  });

  // 重建 Feature Chain 索引
  featureChain.adapter.rebuild();

  // 输出加载结果
  console.log(`Loaded ${workspace.adapter.list().length} workspaces`);
  console.log(`Loaded ${tenetPrompt.adapter.list().length} prompts`);
  console.log(`Loaded ${skill.adapter.list().length} skills`);
  console.log(`Loaded ${sop.adapter.list().length} SOPs`);
  console.log(`MCP Server: ${mcpServer.adapter.getServerInfo().name} v${mcpServer.adapter.getServerInfo().version}`);
  console.log(`Feature Chain: ${featureChain.adapter.search("").length} docs indexed`);
  console.log(`Snail: ${snail.adapter.listTemplates().length} templates`);
  console.log(`IM: ready`);
  console.log(`Lite AI: ${liteAI.repo.getConfig() ? "configured" : "not configured"}`);
  console.log(`Evolution: ready`);
  console.log(`Evolution Governance: ready`);
}

main().catch((err) => {
  console.error("Failed to start", err);
  process.exit(1);
});
