import type express from "express";
import type { ProjectManager } from "../../project-workflow/manager";
import type { KnowledgeKind, KnowledgeScopeType, KnowledgeStatus } from "../../persistence/store";

const SCOPE_TYPES = new Set(["global", "project", "feature", "stage_type", "conversation", "snail", "code_area", "workflow"]);
const KINDS = new Set(["decision", "rule", "preference", "incident", "anti_pattern", "glossary", "open_question", "procedure", "fact", "pattern"]);
const STATUSES = new Set(["candidate", "active", "rejected", "superseded", "deprecated", "archived"]);

export function registerKnowledgeRoutes(router: express.Router, projectManager: ProjectManager): void {
  registerKnowledgeReadRoutes(router, projectManager);
  registerKnowledgeMutationRoutes(router, projectManager);
  registerKnowledgeGovernanceRoutes(router, projectManager);
  registerKnowledgeUsageTrackingRoutes(router, projectManager);
  registerKnowledgeGovernanceConversationRoutes(router, projectManager);
}

function registerKnowledgeReadRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.get("/knowledge", (req, res) => res.json(projectManager.listKnowledge(parseFilters(req.query))));
  router.get("/projects/:projectId/knowledge", (req, res) => res.json(projectManager.listKnowledge({ ...parseFilters(req.query), projectId: req.params.projectId })));
  router.get("/knowledge/candidates", (req, res) => res.json(projectManager.listKnowledge({ ...parseFilters(req.query), status: "candidate" })));
  router.get("/knowledge/:knowledgeId", (req, res) => sendKnowledge(res, projectManager.getKnowledge(req.params.knowledgeId)));
}

function registerKnowledgeGovernanceRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.get("/knowledge-governance", (req, res) => res.json(projectManager.listKnowledgeGovernance(Number(req.query.limit) || 50, Number(req.query.offset) || 0)));
  router.get("/knowledge-governance/:governanceId", (req, res) => sendGovernance(res, projectManager.getKnowledgeGovernance(req.params.governanceId)));
  router.patch("/knowledge-governance/:governanceId", (req, res) => handleKnowledgeMutation(res, () => projectManager.updateKnowledgeGovernance(req.params.governanceId, parseGovernanceBody(req.body ?? {}))));
}

function registerKnowledgeGovernanceConversationRoutes(router: express.Router, projectManager: ProjectManager): void {
  registerGovernanceConversationReadRoutes(router, projectManager);
  registerGovernanceConversationWriteRoutes(router, projectManager);
  registerGovernanceConversationMentionRoutes(router, projectManager);
}

function registerGovernanceConversationReadRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.get("/knowledge/:knowledgeId/governance-conversation", (req, res) => {
    try {
      const resolved = resolveGovernanceConversation(projectManager, req.params.knowledgeId, res);
      if (!resolved) return;
      res.json(resolved.conversation);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/knowledge/:knowledgeId/governance-conversation/messages", (req, res) => {
    try {
      const resolved = resolveGovernanceConversation(projectManager, req.params.knowledgeId, res);
      if (!resolved) return;
      const limit = Number(req.query.limit) || 100;
      const offset = Number(req.query.offset) || 0;
      res.json(projectManager.getConversationMessages(resolved.conversationId, limit, offset));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/knowledge/:knowledgeId/governance-conversation/events", (req, res) => {
    try {
      const resolved = resolveGovernanceConversation(projectManager, req.params.knowledgeId, res);
      if (!resolved) return;
      const afterEventId = Number(req.query.after_event_id) || 0;
      res.json({ items: projectManager.getConversationEventsAfter(resolved.conversationId, afterEventId) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/knowledge/:knowledgeId/governance-conversation/dispatch-state", (req, res) => {
    try {
      const resolved = resolveGovernanceConversation(projectManager, req.params.knowledgeId, res);
      if (!resolved) return;
      res.json(projectManager.getConversationDispatchState(resolved.conversationId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}

function registerGovernanceConversationWriteRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.post("/knowledge/:knowledgeId/governance-conversation/messages", async (req, res) => {
    try {
      const resolved = resolveGovernanceConversation(projectManager, req.params.knowledgeId, res);
      if (!resolved) return;
      const { content, events, from_role, quoted_message_id, client_id } = req.body ?? {};
      const result = await projectManager.sendConversationMessage(resolved.conversationId, {
        content,
        events,
        fromRole: from_role ?? "Boss Role",
        quotedMessageId: quoted_message_id,
        clientId: client_id,
      });
      if ("error" in result) {
        res.status(400).json({ error: result.error.message });
        return;
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/knowledge/:knowledgeId/governance-conversation/messages/:messageId/interrupt", (req, res) => {
    try {
      const resolved = resolveGovernanceConversation(projectManager, req.params.knowledgeId, res);
      if (!resolved) return;
      const messageId = Number(req.params.messageId);
      if (!Number.isInteger(messageId)) {
        res.status(400).json({ error: "message_id must be an integer" });
        return;
      }
      res.json(projectManager.interruptMessage(resolved.conversationId, messageId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}

function registerGovernanceConversationMentionRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.get("/knowledge/:knowledgeId/governance-conversation/boss-mentions", (req, res) => {
    try {
      const resolved = resolveGovernanceConversation(projectManager, req.params.knowledgeId, res);
      if (!resolved) return;
      res.json(projectManager.getBossMentions(resolved.conversationId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/knowledge/:knowledgeId/governance-conversation/boss-mentions/ack", (req, res) => {
    try {
      const resolved = resolveGovernanceConversation(projectManager, req.params.knowledgeId, res);
      if (!resolved) return;
      res.json(projectManager.acknowledgeBossMentions(resolved.conversationId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}

/**
 * 解析知识治理对话，返回 conversation ID 和 conversation 对象。
 * 返回 null 表示知识或治理对话不存在（已发送 404 响应）。
 */
function resolveGovernanceConversation(projectManager: ProjectManager, knowledgeId: string, res: express.Response): { conversationId: string; conversation: any } | null {
  const knowledge = projectManager.getKnowledge(knowledgeId);
  if (!knowledge) {
    res.status(404).json({ error: "Knowledge not found" });
    return null;
  }
  if (!knowledge.governance?.conversation) {
    res.status(404).json({ error: "Governance conversation not found" });
    return null;
  }
  return { conversationId: knowledge.governance.conversation.id, conversation: knowledge.governance.conversation };
}

function registerKnowledgeMutationRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.post("/knowledge", (req, res) => createKnowledge(req, res, projectManager));
  router.post("/knowledge/:knowledgeId/approve", (req, res) => handleKnowledgeMutation(res, () => projectManager.approveKnowledge(req.params.knowledgeId, { reviewer: reviewerFromBody(req.body), comment: req.body?.comment ?? null, updates: req.body?.updates ?? undefined })));
  router.post("/knowledge/:knowledgeId/reject", (req, res) => handleKnowledgeMutation(res, () => projectManager.rejectKnowledge(req.params.knowledgeId, reviewerFromBody(req.body), req.body?.comment ?? null)));
  router.post("/knowledge/:knowledgeId/deprecate", (req, res) => handleKnowledgeMutation(res, () => projectManager.deprecateKnowledge(req.params.knowledgeId, reviewerFromBody(req.body), req.body?.comment ?? null)));
  router.post("/knowledge/:knowledgeId/archive", (req, res) => handleKnowledgeMutation(res, () => projectManager.archiveKnowledge(req.params.knowledgeId, reviewerFromBody(req.body), req.body?.comment ?? null)));
}

function registerKnowledgeUsageTrackingRoutes(router: express.Router, projectManager: ProjectManager): void {
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

function sendGovernance(res: express.Response, item: unknown): void {
  if (!item) res.status(404).json({ error: "Knowledge governance not found" });
  else res.json(item);
}

function parseFilters(query: any): { projectId?: string | null; scopeType?: KnowledgeScopeType; scopeRef?: string; kind?: KnowledgeKind; status?: KnowledgeStatus; query?: string; limit?: number; offset?: number } {
  return { projectId: stringValue(query.project_id), scopeType: enumValue(query.scope_type, SCOPE_TYPES) as KnowledgeScopeType | undefined, scopeRef: stringValue(query.scope_ref), kind: enumValue(query.kind, KINDS) as KnowledgeKind | undefined, status: enumValue(query.status, STATUSES) as KnowledgeStatus | undefined, query: stringValue(query.query), limit: Number(query.limit) || 50, offset: Number(query.offset) || 0 };
}

function parseCreateBody(body: any): { value: any } | { error: string } {
  const validation = validateCreateBody(body);
  if (validation) return { error: validation };
  return { value: { projectId: body.project_id ?? null, scopeType: body.scope_type, scopeRef: body.scope_ref ?? null, kind: body.kind, status: "candidate", governanceLevel: "L0", title: body.title, content: body.content, rationale: body.rationale ?? null, createdBy: body.created_by ?? "Boss Role", metadata: body.metadata ? JSON.stringify(body.metadata) : null, sources: parseSources(body.sources) } };
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

function parseRecordUseBody(knowledgeId: string, body: any): any {
  return { knowledgeId, conversationId: body.conversation_id ?? null, stageId: body.stage_id ?? null, roleName: body.role_name ?? null, useType: body.use_type ?? "manual_reference", outcome: body.outcome ?? null, feedback: body.feedback ?? null };
}

function parseGovernanceBody(body: any): any {
  return {
    entryCheckStatus: stringValue(body.entry_check_status),
    dedupeStatus: stringValue(body.dedupe_status),
    scenarioType: stringValue(body.scenario_type),
    dispositionStatus: stringValue(body.disposition_status),
    artifactType: stringValue(body.artifact_type),
    relatedKnowledgeIds: optionalArrayValue(body, "related_knowledge_ids"),
    finalDestination: optionalNullableStringValue(body, "final_destination"),
    governancePrUrl: optionalNullableStringValue(body, "governance_pr_url"),
    dispositionReason: optionalNullableStringValue(body, "disposition_reason"),
    deferredReason: optionalNullableStringValue(body, "deferred_reason"),
    retriggerCondition: optionalNullableStringValue(body, "retrigger_condition"),
    runtimeFeedbackAllowed: optionalBooleanValue(body, "runtime_feedback_allowed"),
    runtimeFeedbackChannels: optionalArrayValue(body, "runtime_feedback_channels"),
  };
}

function reviewerFromBody(body: any): string {
  return typeof body?.reviewer === "string" && body.reviewer.trim() ? body.reviewer.trim() : "Boss Role";
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

function hasOwnValue(body: any, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function optionalBooleanValue(body: any, key: string): boolean | undefined {
  return hasOwnValue(body, key) ? Boolean(body[key]) : undefined;
}

function optionalArrayValue(body: any, key: string): string[] | undefined {
  return hasOwnValue(body, key) ? arrayValue(body[key]) : undefined;
}

function optionalNullableStringValue(body: any, key: string): string | null | undefined {
  if (!hasOwnValue(body, key)) return undefined;
  return body[key] === null ? null : stringValue(body[key]);
}
