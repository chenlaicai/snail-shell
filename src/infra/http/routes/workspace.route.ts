/**
 * Workspace API 协议 + Hono 路由实现
 *
 * 单一真相源：zod schema 同时是运行时校验 + TS 类型导出
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { toWorkspaceDto } from "@infra/http/workspace-id";
import type { WorkspacePort } from "@domain/workspace/port";

const CreateWorkspaceBodySchema = z.object({
  path: z.string().min(1, "path 不能为空"),
  summary: z.string().optional(),
});

export type WorkspaceDto = {
  id: string;
  path: string;
  summary: string | null;
};
export type CreateWorkspaceBody = z.infer<typeof CreateWorkspaceBodySchema>;

export function createWorkspaceRoutes(port: WorkspacePort) {
  const app = new Hono();

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
      return c.json(port.list(limit, offset).map(toWorkspaceDto) satisfies WorkspaceDto[]);
    },
  );

  app.post(
    "/api/workspaces",
    zValidator("json", CreateWorkspaceBodySchema),
    (c) => {
      const body = c.req.valid("json");
      try {
        return c.json(toWorkspaceDto(port.add(body)) satisfies WorkspaceDto, 201);
      } catch (e) {
        return c.json({ error: (e as Error).message }, 409);
      }
    },
  );

  return app;
}
