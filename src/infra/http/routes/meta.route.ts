import { Hono } from "hono";
import type { TenetPromptPort } from "@domain/tenet-prompt/port";
import type { SkillPort } from "@domain/skill/port";
import type { SopPort } from "@domain/sop/port";
import type { SnailPort } from "@domain/snail/port";
import type { MCPPort } from "@domain/mcp/port";

interface MetaRoutesDeps {
  tenetPrompt: TenetPromptPort;
  skill: SkillPort;
  sop: SopPort;
  snail: SnailPort;
  mcp: MCPPort;
}

export function createMetaRoutes(deps: MetaRoutesDeps) {
  const app = new Hono();

  app.get("/api/meta/prompts", (c) => c.json(deps.tenetPrompt.list()));
  app.get("/api/meta/skills", (c) => c.json(deps.skill.list()));
  app.get("/api/meta/mcps", (c) => c.json(deps.mcp.list()));
  app.get("/api/sops", (c) => c.json(deps.sop.list()));
  app.get("/api/sops/:sopKey", (c) => {
    const sop = deps.sop.findByKey(c.req.param("sopKey"));
    if (!sop) return c.json(null, 404);
    return c.json(sop);
  });
  app.get("/api/snails", (c) => c.json(deps.snail.list()));
  app.get("/api/snail-den", (c) => c.json(deps.snail.list()));

  app.post("/api/snail-den", async (c) => {
    const body = await c.req.json();
    deps.snail.create(body);
    return c.json(body);
  });

  app.put("/api/snail-den/:key", async (c) => {
    const key = c.req.param("key");
    const body = await c.req.json();
    deps.snail.update(key, body);
    return c.json({ key, ...body });
  });

  app.delete("/api/snail-den/:key", (c) => {
    const key = c.req.param("key");
    deps.snail.delete(key);
    return c.json({ ok: true });
  });

  return app;
}
