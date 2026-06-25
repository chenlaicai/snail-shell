import { Hono } from "hono";
import { z } from "zod";
import type { TenetPromptPort } from "@domain/tenet-prompt/port";
import type { SkillPort } from "@domain/skill/port";
import type { SopPort } from "@domain/sop/port";
import type { SnailPort } from "@domain/snail/port";
import type { MCPPort } from "@domain/mcp-config/port";
import { Scope } from "@domain/workspace/model";

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

function registerSnailDenRoutes(app: Hono, snail: SnailPort) {
  app.get("/api/snails", (c) => c.json(snail.list()));
  app.get("/api/snail-den", (c) => c.json(snail.list()));

  app.post("/api/snail-den", async (c) => {
    const parsed = CreateSnailBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    try {
      snail.create(parsed.data);
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
      const updated = snail.update(key, parsed.data);
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
      snail.remove(key);
      return c.json({ ok: true });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("not found")) return c.json({ error: msg }, 404);
      if (msg.includes("Cannot delete")) return c.json({ error: msg }, 409);
      throw e;
    }
  });
}

const RoleDefinitionSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().default(""),
  is_primary: z.boolean().optional().default(false),
  count: z.number().int().positive().optional().default(1),
  skill: z.string().nullable().optional().default(null),
  prohibition: z.string().nullable().optional().default(null),
  self_check: z.string().nullable().optional().default(null),
});

const StageDefinitionSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional().default(""),
  roles: z.array(RoleDefinitionSchema).optional().default([]),
});

const TransitionSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  guard: z.string().nullable().optional().default(null),
});

const CreateSopBodySchema = z.object({
  key: z.string().min(1).regex(KEY_PATTERN, "key must match pattern [a-zA-Z0-9_-]+"),
  name: z.string().min(1),
  description: z.string().nullable().optional().default(null),
  shared_skill: z.string().nullable().optional().default(null),
  stage_definitions: z.array(StageDefinitionSchema).optional().default([]),
  transitions: z.array(TransitionSchema).optional().default([]),
});

const UpdateSopBodySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  shared_skill: z.string().nullable().optional(),
  stage_definitions: z.array(StageDefinitionSchema).optional(),
  transitions: z.array(TransitionSchema).optional(),
}).refine(obj => Object.keys(obj).length > 0, {
  message: "At least one field must be provided",
});

function registerSopRoutes(app: Hono, sop: SopPort) {
  app.post("/api/sops", async (c) => {
    const parsed = CreateSopBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    try {
      const created = sop.create({ ...parsed.data, scope: Scope.Platform });
      return c.json(created, 201);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("already exists")) return c.json({ error: msg }, 409);
      throw e;
    }
  });

  app.patch("/api/sops/:sopKey", async (c) => {
    const sopKey = c.req.param("sopKey");
    if (!KEY_PATTERN.test(sopKey)) {
      return c.json({ error: "sopKey must match pattern [a-zA-Z0-9_-]+" }, 400);
    }
    const raw = await c.req.json();
    if ("key" in raw) {
      return c.json({ error: "key cannot be modified" }, 400);
    }
    if ("scope" in raw) {
      return c.json({ error: "scope cannot be modified" }, 400);
    }
    const parsed = UpdateSopBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    try {
      const updated = sop.update(sopKey, parsed.data);
      return c.json(updated);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("not found")) return c.json({ error: msg }, 404);
      throw e;
    }
  });

  app.delete("/api/sops/:sopKey", (c) => {
    const sopKey = c.req.param("sopKey");
    if (!KEY_PATTERN.test(sopKey)) {
      return c.json({ error: "sopKey must match pattern [a-zA-Z0-9_-]+" }, 400);
    }
    try {
      sop.remove(sopKey);
      return c.json({ ok: true });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("not found")) return c.json({ error: msg }, 404);
      throw e;
    }
  });
}

export function createMetaRoutes(deps: MetaRoutesDeps) {
  const app = new Hono();

  app.get("/api/meta/prompts", (c) => c.json(deps.tenetPrompt.list()));
  app.get("/api/meta/skills", (c) => c.json(deps.skill.list()));
  app.get("/api/meta/mcp-configs", (c) => {
    const configs = deps.mcp.list();
    const dtos = configs.map((config) => ({
      ...config,
      workspace_path: config.workspace?.path,
    }));
    return c.json(dtos);
  });
  app.get("/api/sops", (c) => c.json(deps.sop.list()));
  app.get("/api/sops/:sopKey", (c) => {
    const sop = deps.sop.findByKey(c.req.param("sopKey"));
    if (!sop) return c.json(null, 404);
    return c.json(sop);
  });

  registerSopRoutes(app, deps.sop);
  registerSnailDenRoutes(app, deps.snail);

  return app;
}
