import { Hono } from "hono";
import { cors } from "hono/cors";
import { createWorkspaceRoutes } from "@adapter/http/routes/workspace.route";
import { createIssueRoutes } from "@adapter/http/routes/issue.route";
import { createMetaRoutes } from "@adapter/http/routes/meta.route";
import { createKnowledgeRoutes } from "@adapter/http/routes/knowledge.route";
import { createEvolutionRoutes } from "@adapter/http/routes/evolution.route";
import { createFrontendLogRoutes } from "@adapter/http/routes/frontend-log.route";
import { getLogger } from "@infra/logger";
import type { WorkspacePort } from "@domain/workspace/port";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { MessagePort } from "@domain/message/port";
import type { CollaborationPort } from "@domain/collaboration/port";
import type { TenetPromptPort } from "@domain/tenet-prompt/port";
import type { SkillPort } from "@domain/skill/port";
import type { SopPort } from "@domain/sop/port";
import type { SnailPort } from "@domain/snail/port";
import type { MCPPort } from "@domain/mcp-config/port";
import type { KnowledgePort } from "@domain/knowledge/port";
import type { EvolutionPort } from "@domain/evolution/port";
import type { Hono as HonoApp } from "hono";

const log = getLogger({ module: "http" });

export interface AppDeps {
  workspacePort: WorkspacePort;
  issuePort: IssuePort;
  stagePort: StagePort;
  messagePort: MessagePort;
  collaboration: CollaborationPort;
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

  // HTTP 请求异常日志（next() 抛出的异常）
  app.onError((err, c) => {
    log.error({ method: c.req.method, path: c.req.path, err }, "http.request.error");
    return c.json({ error: "Internal Server Error" }, 500);
  });

  // HTTP 请求日志中间件（跳过健康检查路径）
  app.use("*", async (c, next) => {
    if (c.req.path === "/health") return next();
    const method = c.req.method;
    const path = c.req.path;
    log.info({ method, path }, "http.request.started");
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    const status = c.res.status;
    if (status >= 400) {
      log.error({ method, path, status, duration, slow: duration > 5000 }, "http.request.error");
    } else if (duration > 5000) {
      log.warn({ method, path, status, duration }, "http.request.slow");
    } else {
      log.info({ method, path, status, duration }, "http.request.completed");
    }
  });

  app.route("/", createWorkspaceRoutes(deps.workspacePort));
  app.route("/", createIssueRoutes(deps));
  app.route("/", createMetaRoutes(deps));
  app.route("/", createKnowledgeRoutes(deps));
  app.route("/", createEvolutionRoutes(deps));
  app.route("/", createFrontendLogRoutes());

  if (deps.mcpHandler) {
    app.route("/mcp-server", deps.mcpHandler);
  }

  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}

export type App = ReturnType<typeof createApp>;
