import { Hono } from "hono";
import { z } from "zod";
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

const KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

const CreateSnailBodySchema = z.object({
  key: z.string().min(1).regex(KEY_PATTERN, "key must match pattern [a-zA-Z0-9_-]+"),
  name: z.string().min(1),
  agent_name: z.string().min(1),
  model: z.string().min(1),
  context_window: z.number().int().nonnegative().optional(),
  invocation_timeout_ms: z.number().int().nonnegative().optional(),
});

const UpdateSnailBodySchema = z.object({
  name: z.string().min(1).optional(),
  agent_name: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  context_window: z.number().int().nonnegative().optional(),
  invocation_timeout_ms: z.number().int().nonnegative().optional(),
}).refine(obj => Object.keys(obj).length > 0, {
  message: "At least one non-key field must be provided",
});

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
    const parsed = CreateSnailBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    try {
      deps.snail.create(parsed.data);
      return c.json(parsed.data, 201);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("already exists")) return c.json({ error: msg }, 409);
      throw e;
    }
  });

  app.patch("/api/snail-den/:key", async (c) => {
    const key = c.req.param("key");
    const raw = await c.req.json();
    if ("key" in raw) {
      return c.json({ error: "key cannot be modified" }, 400);
    }
    const parsed = UpdateSnailBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    try {
      const updated = deps.snail.update(key, parsed.data);
      return c.json(updated);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("not found")) return c.json({ error: msg }, 404);
      throw e;
    }
  });

  app.delete("/api/snail-den/:key", (c) => {
    const key = c.req.param("key");
    try {
      deps.snail.remove(key);
      return c.json({ ok: true });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("not found")) return c.json({ error: msg }, 404);
      if (msg.includes("Cannot delete")) return c.json({ error: msg }, 409);
      throw e;
    }
  });

  return app;
}
