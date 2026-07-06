import { Hono } from "hono";
import type { KnowledgePort } from "@domain/knowledge/port";
import type { WorkspacePort } from "@domain/workspace/port";
import type { Scope } from "@domain/workspace/model";
import { decodeWorkspaceId } from "@adapter/http/workspace-id";

interface KnowledgeRoutesDeps {
  knowledge: KnowledgePort;
  workspacePort: WorkspacePort;
}

export function createKnowledgeRoutes(deps: KnowledgeRoutesDeps) {
  const app = new Hono();

  app.get("/api/knowledge/items", (c) => {
    const workspaceId = c.req.query("workspace_id");
    const scope = c.req.query("scope") as Scope | undefined;
    if (workspaceId) {
      const workspace = deps.workspacePort.list().find(item => item.path === decodeWorkspaceId(workspaceId));
      if (!workspace) return c.json([]);
      return c.json(deps.knowledge.findByWorkspace(workspace));
    }
    if (scope === "workspace") return c.json([]);
    return c.json(deps.knowledge.list());
  });

  app.get("/api/knowledge/items/search", (c) => {
    const q = c.req.query("q") ?? "";
    return c.json(deps.knowledge.list().filter(item => item.title.includes(q) || item.content.includes(q)));
  });

  app.get("/api/knowledge/items/summary", (c) => {
    const summary: Record<string, number> = {};
    for (const item of deps.knowledge.list()) summary[item.scope] = (summary[item.scope] ?? 0) + 1;
    return c.json(summary);
  });

  return app;
}
