/**
 * Workspace API 协议 + Hono 路由实现
 *
 * 单一真相源：zod schema 同时是运行时校验 + TS 类型导出
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { WorkspaceAdapter } from "@domain/workspace/_internal/adapter";

// ── Schema ──

/** Workspace 响应体 */
const WorkspaceSchema = z.object({
  path: z.string(),
  summary: z.string().nullable(),
});

/** POST /api/workspaces 请求体 */
const CreateWorkspaceBodySchema = z.object({
  path: z.string().min(1, "path 不能为空"),
  summary: z.string().optional(),
});

// ── 类型导出（供前端引用）──

export type WorkspaceDto = z.infer<typeof WorkspaceSchema>;
export type CreateWorkspaceBody = z.infer<typeof CreateWorkspaceBodySchema>;

// ── 路由 ──

export function createWorkspaceRoutes(adapter: WorkspaceAdapter) {
  const app = new Hono();

  /**
   * GET /api/workspaces — 列出所有 workspace
   *
   * Query: limit?, offset?
   * Response: WorkspaceDto[]
   */
  app.get(
    "/api/workspaces",
    zValidator(
      "query",
      z.object({
        limit: z.coerce.number().int().positive().optional(),
        offset: z.coerce.number().int().min(0).optional(),
      }),
    ),
    (c) => {
      const { limit, offset } = c.req.valid("query");
      const result = adapter.list(limit, offset);
      return c.json(result satisfies WorkspaceDto[]);
    },
  );

  /**
   * POST /api/workspaces — 新增 workspace
   *
   * Body: CreateWorkspaceBody
   * Response: WorkspaceDto (201)
   * Error: { error: string } (409 路径冲突)
   */
  app.post(
    "/api/workspaces",
    zValidator("json", CreateWorkspaceBodySchema),
    (c) => {
      const body = c.req.valid("json");
      try {
        const workspace = adapter.add(body);
        return c.json(workspace satisfies WorkspaceDto, 201);
      } catch (e) {
        return c.json({ error: (e as Error).message }, 409);
      }
    },
  );

  return app;
}
