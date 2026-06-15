import { Hono } from "hono";
import { cors } from "hono/cors";
import { createWorkspaceRoutes } from "@infra/http/routes/workspace.route";
import { createIssueRoutes } from "@infra/http/routes/issue.route";
import { createMetaRoutes } from "@infra/http/routes/meta.route";
import { createKnowledgeRoutes } from "@infra/http/routes/knowledge.route";
import { createEvolutionRoutes } from "@infra/http/routes/evolution.route";
import type { WorkspaceAdapter } from "@domain/workspace/_internal/adapter";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { MessagePort } from "@domain/message/port";
import type { CollaborationInput } from "@app/issue-collaboration/port";
import type { TenetPromptPort } from "@domain/tenet-prompt/port";
import type { SkillPort } from "@domain/skill/port";
import type { SopPort } from "@domain/sop/port";
import type { SnailPort } from "@domain/snail/port";
import type { MCPPort } from "@domain/mcp/port";
import type { KnowledgePort } from "@domain/knowledge/port";
import type { EvolutionPort } from "@domain/evolution/port";
import type { Hono as HonoApp } from "hono";

export interface AppDeps {
  workspaceAdapter: WorkspaceAdapter;
  issuePort: IssuePort;
  stagePort: StagePort;
  messagePort: MessagePort;
  collaboration: CollaborationInput;
  tenetPrompt: TenetPromptPort;
  skill: SkillPort;
  sop: SopPort;
  snail: SnailPort;
  mcp: MCPPort;
  knowledge: KnowledgePort;
  evolution: EvolutionPort;
  mcpHandler?: HonoApp;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.use("*", cors());
  app.route("/", createWorkspaceRoutes(deps.workspaceAdapter));
  app.route("/", createIssueRoutes(deps));
  app.route("/", createMetaRoutes(deps));
  app.route("/", createKnowledgeRoutes(deps));
  app.route("/", createEvolutionRoutes(deps));

  if (deps.mcpHandler) {
    app.route("/mcp", deps.mcpHandler);
  }

  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}

export type App = ReturnType<typeof createApp>;
