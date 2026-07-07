import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { IssueTemplatePort } from "@domain/issue-template/port";
import type { SopPort } from "@domain/sop/port";
import type { IssueTemplate, IssueTemplateWithLastExecution, IssueTemplateChild } from "@domain/issue-template/model";
import { encodeWorkspaceId } from "@adapter/http/workspace-id";

const snailAssignmentPlanSchema = z.record(z.string(), z.record(z.string(), z.string()));

const createBody = z.object({
  workspace_path: z.string().min(1),
  title: z.string().min(1),
  sop_key: z.string().min(1),
  snail_assignment_plan: snailAssignmentPlanSchema,
  cron_expression: z.string().min(1),
  enabled: z.boolean().optional(),
});

const updateBody = z.object({
  title: z.string().min(1).optional(),
  sop_key: z.string().min(1).optional(),
  snail_assignment_plan: snailAssignmentPlanSchema.optional(),
  cron_expression: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

interface IssueTemplateRoutesDeps {
  issueTemplatePort: IssueTemplatePort;
  sopPort: SopPort;
}

export function createIssueTemplateRoutes(deps: IssueTemplateRoutesDeps) {
  const app = new Hono();
  app.get("/api/issue-templates", (c) => c.json(deps.issueTemplatePort.list().map(toDto)));
  app.post("/api/issue-templates", zValidator("json", createBody), (c) => createTemplate(c, deps));
  app.put("/api/issue-templates/:id", zValidator("json", updateBody), (c) => updateTemplate(c, deps));
  app.delete("/api/issue-templates/:id", (c) => deleteTemplate(c, deps));
  app.patch("/api/issue-templates/:id/toggle", (c) => toggleTemplate(c, deps));
  app.get("/api/issue-templates/:id/executions", (c) => listExecutions(c, deps));
  app.get("/api/issue-templates/:id/children", (c) => c.json(deps.issueTemplatePort.listChildren(requiredParam(c, "id")).map(toChildDto)));
  return app;
}

async function createTemplate(c: Context, deps: IssueTemplateRoutesDeps) {
  const body = createBody.parse(await c.req.json());
  try {
    const sop = deps.sopPort.findByKey(body.sop_key);
    if (!sop) return c.json({ error: `SOP not found: ${body.sop_key}` }, 400);
    const template = deps.issueTemplatePort.create({
      workspace_path: body.workspace_path, title: body.title, sop_key: body.sop_key,
      sop_snapshot: structuredClone(sop), snail_assignment_plan: body.snail_assignment_plan,
      cron_expression: body.cron_expression, enabled: body.enabled,
    });
    return c.json(toDto(template), 201);
  } catch (error) {
    if (error instanceof Error && isValidationError(error.message)) return c.json({ error: error.message }, 400);
    throw error;
  }
}

async function updateTemplate(c: Context, deps: IssueTemplateRoutesDeps) {
  const id = requiredParam(c, "id");
  const body = updateBody.parse(await c.req.json());
  try {
    const sopSnapshot = body.sop_key ? resolveSop(deps, body.sop_key) : undefined;
    const template = deps.issueTemplatePort.update(id, { ...body, sop_snapshot: sopSnapshot });
    return c.json(toDto(template));
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.startsWith("IssueTemplate not found:")) return c.json({ error: "IssueTemplate not found" }, 404);
      if (isValidationError(error.message)) return c.json({ error: error.message }, 400);
    }
    throw error;
  }
}

function deleteTemplate(c: Context, deps: IssueTemplateRoutesDeps) {
  try {
    deps.issueTemplatePort.remove(requiredParam(c, "id"));
    return c.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("IssueTemplate not found:")) return c.json({ error: "IssueTemplate not found" }, 404);
    throw error;
  }
}

function toggleTemplate(c: Context, deps: IssueTemplateRoutesDeps) {
  try {
    return c.json(toDto(deps.issueTemplatePort.toggle(requiredParam(c, "id"))));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("IssueTemplate not found:")) return c.json({ error: "IssueTemplate not found" }, 404);
    throw error;
  }
}

function listExecutions(c: Context, deps: IssueTemplateRoutesDeps) {
  return c.json(deps.issueTemplatePort.listExecutions(requiredParam(c, "id")));
}

function requiredParam(c: Context, key: string): string {
  const value = c.req.param(key);
  if (!value) throw new Error(`Missing route param: ${key}`);
  return value;
}

function resolveSop(deps: IssueTemplateRoutesDeps, sopKey: string) {
  const sop = deps.sopPort.findByKey(sopKey);
  if (!sop) throw new Error(`SOP not found: ${sopKey}`);
  return structuredClone(sop);
}

function isValidationError(message: string): boolean {
  return message.includes("cron") || message.includes("snail assignment") || message.includes("stage definitions") || message.includes("SOP not found");
}

function toDto(template: IssueTemplate | IssueTemplateWithLastExecution) {
  return {
    id: template.id, workspace_path: template.workspace_path, workspace_id: encodeWorkspaceId(template.workspace_path), title: template.title,
    sop_key: template.sop_key, sop_snapshot: template.sop_snapshot,
    snail_assignment_plan: template.snail_assignment_plan, cron_expression: template.cron_expression,
    enabled: template.enabled, last_spawned_at: template.last_spawned_at,
    consecutive_failures: template.consecutive_failures, created_at: template.created_at,
    updated_at: template.updated_at,
    last_status: ("last_status" in template ? template.last_status : null) ?? null,
    last_child_issue_id: ("last_child_issue_id" in template ? template.last_child_issue_id : null) ?? null,
  };
}

function toChildDto(child: IssueTemplateChild) {
  return {
    child_issue_id: child.child_issue_id,
    title: child.title,
    status: child.status,
    workspace_id: encodeWorkspaceId(child.workspace_path),
    created_at: child.created_at,
  };
}
