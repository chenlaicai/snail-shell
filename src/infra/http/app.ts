/**
 * Hono App 组装
 *
 * 所有路由在这里汇聚，导出 App 类型供前端 hc 客户端使用。
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { createWorkspaceRoutes } from "./routes/workspace.route";
import type { WorkspaceAdapter } from "@domain/workspace/_internal/adapter";
import type { Hono as HonoApp } from "hono";

export interface AppDeps {
  workspaceAdapter: WorkspaceAdapter;
  mcpHandler?: HonoApp;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  // 中间件
  app.use("*", cors());

  // 路由挂载
  app.route("/", createWorkspaceRoutes(deps.workspaceAdapter));

  // MCP Server 路由
  if (deps.mcpHandler) {
    app.route("/mcp", deps.mcpHandler);
  }

  // 健康检查
  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}

export type App = ReturnType<typeof createApp>;
