import { serve } from "@hono/node-server";
import { FileDataStore } from "@infra/file-data-store";
import { SQLiteDatabase } from "@infra/database";
import { createApp } from "@infra/http/app";
import { init as initWorkspace } from "@domain/workspace/_internal/initor";
import { init as initTenetPrompt } from "@domain/tenet-prompt/_internal/initor";
import { init as initSkill } from "@domain/skill/_internal/initor";
import { init as initSop } from "@domain/sop/_internal/initor";
import { init as initMCPServer } from "@domain/snail-mcp-server/_internal/initor";
import { initHono as initIM } from "@domain/im/_internal/hono-initor";
import { init as initKnowledge } from "@domain/knowledge/_internal/initor";
import { init as initIssue } from "@domain/issue/_internal/adapter";
import { init as initEvolution } from "@domain/evolution/_internal/adapter";
import { initGovernance as initEvolutionGovernance } from "@app/evolution-governance/governance";
import { init as initFeatureChain } from "@domain/feature-chain/_internal/initor";
import { init as initSnail } from "@domain/snail/_internal/initor";
import { init as initLiteAI } from "@domain/lite-ai/_internal/initor";
import { createMcpHandler } from "@infra/mcp-server/handler";

async function main() {
  const repoRoot = process.cwd();

  // 基础设施 — 目录结构由 infra 内部管理
  const db = new SQLiteDatabase(repoRoot);           // → data/database/snail-shell.db
  const fileDataStore = new FileDataStore(repoRoot);  // → data/file/

  // FileDataStore — 所有运行时文件数据（workspace, sop, snail, lite-ai, skill, tenet-prompt）
  const workspace = initWorkspace(fileDataStore);
  const workspaces = workspace.repo.list();
  const sop = initSop(fileDataStore, workspaces);
  const snail = initSnail(fileDataStore);
  const liteAI = initLiteAI(fileDataStore);
  const tenetPrompt = initTenetPrompt(fileDataStore, workspaces);
  const skill = initSkill(fileDataStore, workspaces);

  // FileLoader — 源码目录（feature-chain 读取 docs/features/，initor 内部创建）
  const featureChain = initFeatureChain(repoRoot);

  // 纯内存模块
  const snailMCPServer = initMCPServer();

  // 注册 snail-final-response MCP Server
  snailMCPServer.adapter.registerServer({
    name: "snail-final-response",
    version: "1.0.0",
    tools: [
      {
        name: "set_final_body",
        description: "设置消息的最终展示正文（Markdown）",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "最终 Markdown 正文" },
            conversation_id: { type: "string" },
            message_id: { type: "string" },
          },
          required: ["text", "conversation_id", "message_id"],
        },
        handler: async (params) => {
          // TODO: 实现 set_final_body 逻辑
          return { ok: true };
        },
      },
    ],
  });

  const im = initIM();
  const knowledge = initKnowledge();
  const issue = initIssue(sop.repo);
  const evolution = initEvolution();
  const evolutionGovernance = initEvolutionGovernance(
    evolution.adapter,
    issue.adapter,
    im.adapter,
    sop.adapter,
  );

  // 重建 Feature Chain 索引
  featureChain.adapter.rebuild();

  // 输出加载结果
  console.log(`Loaded ${workspace.adapter.list().length} workspaces`);
  console.log(`Loaded ${tenetPrompt.adapter.list().length} prompts`);
  console.log(`Loaded ${skill.adapter.list().length} skills`);
  console.log(`Loaded ${sop.adapter.list().length} SOPs`);
  console.log(`MCP Servers: ${snailMCPServer.adapter.listServers().map(s => s.name).join(", ")}`);
  console.log(`Feature Chain: ${featureChain.adapter.search("").length} docs indexed`);
  console.log(`Snail: ${snail.adapter.listTemplates().length} templates`);
  console.log(`IM: ready`);
  console.log(`Lite AI: ${liteAI.repo.getConfig() ? "configured" : "not configured"}`);
  console.log(`Evolution: ready`);
  console.log(`Evolution Governance: ready`);

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
