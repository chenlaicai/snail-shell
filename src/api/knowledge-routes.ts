import type express from "express";
import type { ProjectManager } from "../project/manager";
import type { KnowledgeKind, KnowledgeScopeType, KnowledgeStatus } from "../persistence/store";

const SCOPE_TYPES = new Set(["global", "project", "feature", "stage_type", "conversation", "snail", "code_area", "workflow"]);
const KINDS = new Set(["decision", "rule", "preference", "incident", "anti_pattern", "glossary", "open_question", "procedure", "fact", "pattern"]);
const STATUSES = new Set(["candidate", "active", "rejected", "superseded", "deprecated", "archived"]);

export function registerKnowledgeRoutes(router: express.Router, projectManager: ProjectManager): void {
  registerKnowledgeReadRoutes(router, projectManager);
  registerKnowledgeMutationRoutes(router, projectManager);
  registerKnowledgeUsageRoutes(router, projectManager);
}

function registerKnowledgeReadRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.get("/knowledge", (req, res) => res.json(projectManager.listKnowledge(parseFilters(req.query))));
  router.get("/projects/:projectId/knowledge", (req, res) => res.json(projectManager.listKnowledge({ ...parseFilters(req.query), projectId: req.params.projectId })));
  router.get("/knowledge/candidates", (req, res) => res.json(projectManager.listKnowledge({ ...parseFilters(req.query), status: "candidate" })));
  router.get("/knowledge/:knowledgeId", (req, res) => sendKnowledge(res, projectManager.getKnowledge(req.params.knowledgeId)));
}

function registerKnowledgeMutationRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.post("/knowledge", (req, res) => createKnowledge(req, res, projectManager));
  router.post("/knowledge/:knowledgeId/approve", (req, res) => handleKnowledgeMutation(res, () => projectManager.approveKnowledge(req.params.knowledgeId, { reviewer: reviewerFromBody(req.body), comment: req.body?.comment ?? null, updates: req.body?.updates ?? undefined })));
  router.post("/knowledge/:knowledgeId/reject", (req, res) => handleKnowledgeMutation(res, () => projectManager.rejectKnowledge(req.params.knowledgeId, reviewerFromBody(req.body), req.body?.comment ?? null)));
  router.post("/knowledge/:knowledgeId/deprecate", (req, res) => handleKnowledgeMutation(res, () => projectManager.deprecateKnowledge(req.params.knowledgeId, reviewerFromBody(req.body), req.body?.comment ?? null)));
  router.post("/knowledge/:knowledgeId/archive", (req, res) => handleKnowledgeMutation(res, () => projectManager.archiveKnowledge(req.params.knowledgeId, reviewerFromBody(req.body), req.body?.comment ?? null)));
}

function registerKnowledgeUsageRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.get("/knowledge/:knowledgeId/usage-policy", (req, res) => sendPolicy(res, projectManager.getKnowledge(req.params.knowledgeId)));
  router.put("/knowledge/:knowledgeId/usage-policy", (req, res) => handleKnowledgeMutation(res, () => projectManager.upsertKnowledgeUsagePolicy(req.params.knowledgeId, parsePolicyBody(req.body ?? {}))));
  router.get("/knowledge/:knowledgeId/uses", (req, res) => res.json(projectManager.listKnowledgeUses(req.params.knowledgeId)));
  router.post("/knowledge/:knowledgeId/record-use", (req, res) => {
    res.status(201).json(projectManager.recordKnowledgeUse(parseRecordUseBody(req.params.knowledgeId, req.body ?? {})));
  });
}

function createKnowledge(req: express.Request, res: express.Response, projectManager: ProjectManager): void {
  const parsed = parseCreateBody(req.body ?? {});
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  res.status(201).json(projectManager.createKnowledge(parsed.value));
}

function handleKnowledgeMutation(res: express.Response, action: () => unknown): void {
  try {
    res.json(action());
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
}

function sendKnowledge(res: express.Response, item: unknown): void {
  if (!item) res.status(404).json({ error: "Knowledge not found" });
  else res.json(item);
}

function sendPolicy(res: express.Response, item: any): void {
  if (!item) res.status(404).json({ error: "Knowledge not found" });
  else res.json(item.usage_policy);
}

function parseFilters(query: any): { projectId?: string | null; scopeType?: KnowledgeScopeType; scopeRef?: string; kind?: KnowledgeKind; status?: KnowledgeStatus; query?: string; limit?: number; offset?: number } {
  return { projectId: stringValue(query.project_id), scopeType: enumValue(query.scope_type, SCOPE_TYPES) as KnowledgeScopeType | undefined, scopeRef: stringValue(query.scope_ref), kind: enumValue(query.kind, KINDS) as KnowledgeKind | undefined, status: enumValue(query.status, STATUSES) as KnowledgeStatus | undefined, query: stringValue(query.query), limit: Number(query.limit) || 50, offset: Number(query.offset) || 0 };
}

function parseCreateBody(body: any): { value: any } | { error: string } {
  const validation = validateCreateBody(body);
  if (validation) return { error: validation };
  return { value: { projectId: body.project_id ?? null, scopeType: body.scope_type, scopeRef: body.scope_ref ?? null, kind: body.kind, status: "candidate", governanceLevel: "L0", title: body.title, content: body.content, rationale: body.rationale ?? null, createdBy: body.created_by ?? "Boss Snail", metadata: body.metadata ? JSON.stringify(body.metadata) : null, sources: parseSources(body.sources) } };
}

function validateCreateBody(body: any): string | null {
  if (!body.title || typeof body.title !== "string") return "title is required";
  if (!body.content || typeof body.content !== "string") return "content is required";
  if (!enumValue(body.scope_type, SCOPE_TYPES)) return "scope_type is invalid";
  if (!enumValue(body.kind, KINDS)) return "kind is invalid";
  return null;
}

function parseSources(sources: unknown): any[] {
  if (!Array.isArray(sources)) return [];
  return sources.map((source: any) => ({ id: source.id || `${Date.now()}:${Math.random()}`, sourceType: source.source_type || "external", sourceId: source.source_id || "manual", quote: source.quote ?? null }));
}

function parsePolicyBody(body: any): any {
  return { allowPromptInjection: Boolean(body.allow_prompt_injection), promptMode: body.prompt_mode, skillVisibility: arrayValue(body.skill_visibility), toolVisibility: arrayValue(body.tool_visibility), checkerBinding: body.checker_binding ?? null, stageTypes: arrayValue(body.stage_types), snailNames: arrayValue(body.snail_names), priority: Number(body.priority) || 0, tokenBudget: body.token_budget === null || body.token_budget === undefined ? null : Number(body.token_budget) };
}

function parseRecordUseBody(knowledgeId: string, body: any): any {
  return { knowledgeId, conversationId: body.conversation_id ?? null, stageId: body.stage_id ?? null, snailName: body.snail_name ?? null, useType: body.use_type ?? "manual_reference", outcome: body.outcome ?? null, feedback: body.feedback ?? null };
}

function reviewerFromBody(body: any): string {
  return typeof body?.reviewer === "string" && body.reviewer.trim() ? body.reviewer.trim() : "Boss Snail";
}

function enumValue(value: unknown, allowed: Set<string>): string | undefined {
  return typeof value === "string" && allowed.has(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function arrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
