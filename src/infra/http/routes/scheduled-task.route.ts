import { Hono } from "hono";
import type { ScheduledTaskPort } from "@domain/scheduled-task/port";

interface ScheduledTaskRoutesDeps {
  scheduledTask: ScheduledTaskPort;
}

export function createScheduledTaskRoutes(deps: ScheduledTaskRoutesDeps) {
  const app = new Hono();

  /** 列表（含最近一次执行状态） */
  app.get("/api/scheduled-tasks", (c) => {
    const tasks = deps.scheduledTask.list();
    return c.json(tasks);
  });

  /** 创建 */
  app.post("/api/scheduled-tasks", async (c) => {
    const body = await c.req.json<{
      key: string;
      title: string;
      sop_key: string;
      workspace_path: string;
      interval_days: number;
      enabled?: boolean;
    }>();

    try {
      const task = deps.scheduledTask.create(body);
      return c.json(task, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  /** 更新 */
  app.put("/api/scheduled-tasks/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{
      title?: string;
      sop_key?: string;
      workspace_path?: string;
      interval_days?: number;
      enabled?: boolean;
    }>();

    try {
      const task = deps.scheduledTask.update(id, body);
      return c.json(task);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("not found") ? 404 : 400;
      return c.json({ error: msg }, status);
    }
  });

  /** 删除 */
  app.delete("/api/scheduled-tasks/:id", (c) => {
    const id = c.req.param("id");
    try {
      deps.scheduledTask.remove(id);
      return c.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("not found") ? 404 : 400;
      return c.json({ error: msg }, status);
    }
  });

  /** 执行历史 */
  app.get("/api/scheduled-tasks/:id/executions", (c) => {
    const id = c.req.param("id");
    const executions = deps.scheduledTask.listExecutions(id);
    return c.json(executions);
  });

  return app;
}
