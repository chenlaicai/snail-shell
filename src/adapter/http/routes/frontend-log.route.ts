import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getWebLogger } from "@infra/logger";

const frontendLogSchema = z.object({
  level: z.enum(["info", "warn", "error"]),
  type: z.string(),
  metric: z.string(),
  url: z.string().optional(),
  duration: z.number().optional(),
  reason: z.string().optional(),
  ts: z.number(),
});

const frontendLogBatchSchema = z.object({
  logs: z.array(frontendLogSchema).min(1).max(50),
});

export function createFrontendLogRoutes(): Hono {
  const app = new Hono();
  const webLog = getWebLogger();

  /** 批量接收前端性能日志，写入 web.log */
  app.post("/api/frontend-log", zValidator("json", frontendLogBatchSchema), (c) => {
    const { logs } = c.req.valid("json");
    for (const entry of logs) {
      const payload = { type: entry.type, metric: entry.metric, url: entry.url, duration: entry.duration, reason: entry.reason, ts: entry.ts };
      switch (entry.level) {
        case "error": webLog.error(payload, entry.type); break;
        case "warn": webLog.warn(payload, entry.type); break;
        default: webLog.info(payload, entry.type);
      }
    }
    return c.json({ ok: true });
  });

  return app;
}
