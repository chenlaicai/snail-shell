import express from "express";
import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import type { ProjectManager } from "../../project-workflow/manager";
import { assertRequiredFeatureWorkflowStages, type StageDefinitionInput } from "../../project-workflow/workflow";
import { listPrompts, listFrames } from "../../prompt-center";
import { listSkills } from "../../skill-center";
import type { SnailDen } from "../../snail-den";
import { logger } from "../../logger";
import { ConversationGateway } from "../gateway";
import type { ConversationStore } from "../../persistence/store";
import { registerFeatureRoutes } from "./feature-routes";
import { registerKnowledgeRoutes } from "./knowledge-routes";
import { isConversationKind, isRoleName } from "./validation";

export function createServer(projectManager: ProjectManager, snailDen: SnailDen, store: ConversationStore, conversationGateway = new ConversationGateway(projectManager)): { app: express.Express; server: http.Server } {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  registerRoutes(router, projectManager, snailDen, conversationGateway);
  app.use("/api", router);

  registerMcpEndpoint(app, store);

  const server = http.createServer(app);
  bindWebSocketServer(server, conversationGateway);

  return { app, server };
}

function registerRoutes(router: express.Router, projectManager: ProjectManager, snailDen: SnailDen, conversationGateway: ConversationGateway): void {
  registerMetaRoutes(router, snailDen);
  registerProjectRoutes(router, projectManager, snailDen);
  registerConversationRoutes(router, projectManager, conversationGateway);
  registerRoleRoutes(router, projectManager);
  registerKnowledgeRoutes(router, projectManager);
}

function registerMetaRoutes(router: express.Router, snailDen: SnailDen): void {
  router.get("/meta/prompts", (_req, res) => {
    res.json(listPrompts().map((prompt) => ({
      ...prompt,
      filePath: prompt.filePath.replace(`${process.cwd()}/`, ""),
    })));
  });

  router.get("/meta/frames", (_req, res) => {
    res.json(listFrames().map((frame) => ({
      ...frame,
      filePath: frame.filePath.replace(`${process.cwd()}/`, ""),
    })));
  });

  router.get("/meta/skills", (_req, res) => {
    res.json(listSkills().map((skill) => ({
      ...skill,
      filePath: skill.filePath.replace(`${process.cwd()}/`, ""),
    })));
  });

  router.get("/snail-den", (_req, res) => {
    res.json(snailDen.listTemplates());
  });
}

function registerProjectRoutes(router: express.Router, projectManager: ProjectManager, snailDen: SnailDen): void {
  registerFeatureRoutes(router, projectManager);

  router.get("/projects", (req, res) => {
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    res.json(projectManager.listProjects(limit, offset));
  });

  router.post("/projects", (req, res) => {
    const { name, summary, kind, stage_definitions } = req.body ?? {};
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required" });
      return;
    }
    try {
      const stageDefinitions = normalizeStageDefinitions(stage_definitions);
      assertRequiredFeatureWorkflowStages(stageDefinitions);
      assertStageTemplatesExist(stageDefinitions, snailDen);
      const result = projectManager.createProject(name, summary, kind === "system_self" ? kind : "product_delivery", stageDefinitions);
      logger.debug("Project created", { projectId: result.project.id, featureId: result.feature.id, stageId: result.stage.id, conversationId: result.conversation.id });
      res.status(201).json(result);
    } catch (err: any) {
      logger.warn("Project creation failed", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  router.get("/projects/:projectId", (req, res) => {
    const project = projectManager.getProject(req.params.projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(project);
  });

  router.get("/projects/:projectId/stages", (req, res) => {
    res.json(projectManager.listStages(req.params.projectId));
  });

  router.get("/projects/:projectId/features", (req, res) => {
    res.json(projectManager.listFeatures(req.params.projectId));
  });

  router.get("/projects/:projectId/conversations", (req, res) => {
    res.json(projectManager.listProjectConversations(req.params.projectId));
  });
}

function assertStageTemplatesExist(stageDefinitions: StageDefinitionInput[] | undefined, snailDen: SnailDen): void {
  if (!stageDefinitions) return;
  for (const stage of stageDefinitions) {
    for (const role of stage.roles) {
      if (!snailDen.getTemplate(role.snail_template_id)) {
        throw new Error(`Snail Den 中未找到 template: ${role.snail_template_id}`);
      }
    }
  }
}

function normalizeStageDefinitions(input: unknown): StageDefinitionInput[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length === 0) throw new Error("stage_definitions must be a non-empty array");
  const stageKeys = new Set<string>();

  return input.map((stage, index) => {
    if (!stage || typeof stage !== "object") throw new Error(`stage_definitions[${index}] must be an object`);
    const source = stage as Record<string, unknown>;
    const key = requiredString(source.key, `stage_definitions[${index}].key`);
    if (stageKeys.has(key)) throw new Error(`stage key must be unique: ${key}`);
    stageKeys.add(key);
    const title = requiredString(source.title, `stage_definitions[${index}].title`);
    const roles = normalizeStageRoles(source.roles, `stage_definitions[${index}].roles`);
    if (!roles.some((role) => role.is_primary)) throw new Error(`stage ${key} must have a primary role`);
    return {
      key,
      title,
      sequence: optionalNumber(source.sequence) ?? index + 1,
      input_description: optionalString(source.input_description),
      output_description: optionalString(source.output_description),
      acceptance_focus: optionalStringArray(source.acceptance_focus, `stage_definitions[${index}].acceptance_focus`),
      roles,
    };
  });
}

function normalizeStageRoles(input: unknown, fieldName: string): StageDefinitionInput["roles"] {
  if (!Array.isArray(input) || input.length === 0) throw new Error(`${fieldName} must be a non-empty array`);
  const names = new Set<string>();
  return input.map((role, index) => {
    if (!role || typeof role !== "object") throw new Error(`${fieldName}[${index}] must be an object`);
    const source = role as Record<string, unknown>;
    const name = requiredString(source.name, `${fieldName}[${index}].name`);
    if (names.has(name)) throw new Error(`role name must be unique inside a stage: ${name}`);
    names.add(name);
    return {
      name,
      snail_template_id: requiredString(source.snail_template_id, `${fieldName}[${index}].snail_template_id`),
      is_primary: Boolean(source.is_primary),
      description: optionalString(source.description) ?? "",
      working_rules: optionalStringArray(source.working_rules, `${fieldName}[${index}].working_rules`),
    };
  });
}

function requiredString(input: unknown, fieldName: string): string {
  if (typeof input !== "string" || input.trim().length === 0) throw new Error(`${fieldName} is required`);
  return input.trim();
}

function optionalString(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalNumber(input: unknown): number | null {
  if (typeof input !== "number" || !Number.isFinite(input)) return null;
  return input;
}

function optionalStringArray(input: unknown, fieldName: string): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error(`${fieldName} must be an array`);
  return input.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function registerConversationRoutes(router: express.Router, projectManager: ProjectManager, conversationGateway: ConversationGateway): void {
  registerConversationCreationRoutes(router, projectManager);
  registerConversationHistoryRoutes(router, projectManager, conversationGateway);
}

function registerConversationCreationRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.post("/features/:featureId/stages/:stageId/conversations", (req, res) => {
    const { project_id, title, kind, from_conversation_ids, summary } = req.body ?? {};
    if (!project_id || typeof project_id !== "string") {
      res.status(400).json({ error: "project_id is required" });
      return;
    }
    if (!title || typeof title !== "string") {
      res.status(400).json({ error: "title is required" });
      return;
    }
    if (!kind || typeof kind !== "string" || !isConversationKind(kind)) {
      res.status(400).json({ error: "kind must be a valid conversation kind" });
      return;
    }
    if (from_conversation_ids !== undefined && !Array.isArray(from_conversation_ids)) {
      res.status(400).json({ error: "from_conversation_ids must be an array" });
      return;
    }
    try {
      const conversation = projectManager.createConversation({
        projectId: req.body.project_id,
        featureId: req.params.featureId,
        stageId: req.params.stageId,
        title,
        kind,
        fromConversationIds: from_conversation_ids,
        summary,
      });
      logger.debug("Conversation created", { conversationId: conversation.id, projectId: req.body.project_id, featureId: req.params.featureId, stageId: req.params.stageId });
      res.status(201).json(conversation);
    } catch (err: any) {
      logger.warn("Conversation creation failed", { projectId: req.body.project_id, featureId: req.params.featureId, stageId: req.params.stageId, error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  router.get("/conversations/:conversationId", (req, res) => {
    const conversation = projectManager.getConversation(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json(conversation);
  });
}

function registerConversationHistoryRoutes(router: express.Router, projectManager: ProjectManager, conversationGateway: ConversationGateway): void {
  registerConversationMessageReadRoutes(router, projectManager);
  registerConversationMessageWriteRoutes(router, projectManager, conversationGateway);
}

function registerConversationMessageReadRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.get("/conversations/:conversationId/messages", (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    res.json(projectManager.getConversationMessages(req.params.conversationId, limit, offset));
  });

  router.get("/conversations/:conversationId/messages/page", (req, res) => {
    const limit = Number(req.query.limit) || 10;
    const offset = Number(req.query.offset) || 0;
    res.json(projectManager.getConversationMessagesPage(req.params.conversationId, limit, offset));
  });

  router.get("/conversations/:conversationId/messages/recent", (req, res) => {
    const limit = Number(req.query.limit) || 5;
    res.json(projectManager.getRecentConversationMessages(req.params.conversationId, limit));
  });

  router.get("/conversations/:conversationId/events", (req, res) => {
    const afterEventId = Number(req.query.after_event_id) || 0;
    res.json({ items: projectManager.getConversationEventsAfter(req.params.conversationId, afterEventId) });
  });

  router.post("/conversations/:conversationId/messages/by-ids", (req, res) => {
    const messageIds = Array.isArray(req.body?.message_ids)
      ? req.body.message_ids.map((value: unknown) => Number(value)).filter((value: number) => Number.isInteger(value))
      : [];
    if (messageIds.length === 0) {
      res.status(400).json({ error: "message_ids is required" });
      return;
    }
    res.json(projectManager.getConversationMessagesByIds(req.params.conversationId, messageIds));
  });

  router.get("/conversations/:conversationId/messages/window", (req, res) => {
    const anchorMessageId = Number(req.query.anchor_message_id);
    if (!Number.isInteger(anchorMessageId)) {
      res.status(400).json({ error: "anchor_message_id is required" });
      return;
    }
    const before = Number(req.query.before) || 2;
    const after = Number(req.query.after) || 2;
    res.json(projectManager.getConversationMessageWindow(req.params.conversationId, anchorMessageId, before, after));
  });

  router.get("/conversations/:conversationId/dispatch-state", (req, res) => {
    try {
      res.json(projectManager.getConversationDispatchState(req.params.conversationId));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get("/conversations/:conversationId/boss-mentions", (req, res) => {
    try {
      res.json(projectManager.getBossMentions(req.params.conversationId));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.post("/conversations/:conversationId/boss-mentions/ack", (req, res) => {
    try {
      res.json(projectManager.acknowledgeBossMentions(req.params.conversationId));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get("/conversations/:conversationId/history/search", (req, res) => {
    const query = typeof req.query.query === "string" ? req.query.query : "";
    if (!query.trim()) {
      res.status(400).json({ error: "query is required" });
      return;
    }
    const limit = Number(req.query.limit) || 5;
    const offset = Number(req.query.offset) || 0;
    res.json(projectManager.searchConversationHistory(req.params.conversationId, query, limit, offset));
  });
}

function registerConversationMessageWriteRoutes(router: express.Router, projectManager: ProjectManager, conversationGateway: ConversationGateway): void {
  router.post("/conversations/:conversationId/messages/:messageId/interrupt", (req, res) => {
    try {
      const messageId = Number(req.params.messageId);
      if (!Number.isInteger(messageId)) {
        res.status(400).json({ error: "message_id must be an integer" });
        return;
      }
      res.json(projectManager.interruptMessage(req.params.conversationId, messageId));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.post("/conversations/:conversationId/messages", async (req, res) => {
    const { content, events, from_role, producer_role, quoted_message_id, asker_role, client_id } = req.body ?? {};
    const fromRole = from_role ?? producer_role ?? "Boss Role";
    const askerRole = typeof asker_role === "string" && isRoleName(asker_role)
      ? asker_role
      : null;
    try {
      logger.debug("Conversation message request", { conversationId: req.params.conversationId });
      const result = await conversationGateway.sendMessage(req.params.conversationId, {
        content,
        events,
        fromRole,
        quotedMessageId: quoted_message_id,
        askerRole,
        clientId: client_id,
      });
      if ("error" in result) {
        res.status(400).json({ error: result.error.message, hint: result.error.hint });
        return;
      }
      res.json(result);
    } catch (err: any) {
      logger.error("Conversation message failed", { conversationId: req.params.conversationId, error: err.message, stack: err.stack });
      res.status(500).json({ error: err.message });
    }
  });
}

function registerRoleRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.get("/roles", (_req, res) => {
    res.json(projectManager.listRoles());
  });
}

function bindWebSocketServer(server: http.Server, conversationGateway: ConversationGateway): void {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const conversationClients = new Map<string, Set<WebSocket>>();
  const conversationUnsubscribers = new Map<string, () => void>();

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const conversationId = url.searchParams.get("conversation_id");
    if (!conversationId) {
      ws.close(4000, "conversation_id required");
      return;
    }
    logger.debug("WebSocket connected", { conversationId });

    if (!conversationClients.has(conversationId)) {
      conversationClients.set(conversationId, new Set());
    }
    conversationClients.get(conversationId)!.add(ws);

    sendBackfillAfterSubscribed(ws, conversationGateway, conversationId, Number(url.searchParams.get("after_event_id")) || 0);

    ws.on("close", () => {
      logger.debug("WebSocket disconnected", { conversationId });
      const clients = conversationClients.get(conversationId);
      clients?.delete(ws);
      if (clients?.size === 0) {
        conversationClients.delete(conversationId);
        conversationUnsubscribers.get(conversationId)?.();
        conversationUnsubscribers.delete(conversationId);
      }
    });

    const sendError = (error: string, hint?: string, clientId?: string | null) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", error, hint, ...(clientId ? { client_id: clientId } : {}) }));
      }
    };

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "send_message") {
          handleWebSocketSendMessage(conversationGateway, conversationId, msg, sendError);
        }
      } catch {
        // ignore malformed messages
      }
    });

    if (!conversationUnsubscribers.has(conversationId)) {
      conversationUnsubscribers.set(conversationId, conversationGateway.subscribe(conversationId, (event) => {
        const clients = conversationClients.get(conversationId);
        if (!clients) return;
        const data = JSON.stringify({ type: "agent_event", conversation_id: conversationId, event });
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) client.send(data);
        }
      }));
    }
  });

  conversationGateway.onBadge((payload: { conversation_id: string; feature_id: string | null; stage_id: string | null; boss_pending_count: number }) => {
    const clients = conversationClients.get(payload.conversation_id);
    if (!clients) return;
    const data = JSON.stringify({ type: "conversation_badge", payload });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  });
}

function sendBackfillAfterSubscribed(ws: WebSocket, conversationGateway: ConversationGateway, conversationId: string, afterEventId: number): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  for (const event of conversationGateway.getBackfill(conversationId, afterEventId)) {
    const data = JSON.stringify({ type: "agent_event", conversation_id: conversationId, event });
    ws.send(data);
  }
}

function handleWebSocketSendMessage(
  conversationGateway: ConversationGateway,
  conversationId: string,
  msg: any,
  sendError: (error: string, hint?: string, clientId?: string | null) => void
): void {
  logger.debug("WebSocket send_message received", { conversationId });
  const clientId = typeof msg.client_id === "string" && msg.client_id.trim() ? msg.client_id.trim() : null;
  conversationGateway.sendMessageAsync(conversationId, {
    content: msg.content,
    events: msg.events,
    fromRole: msg.from_role ?? msg.producer_role ?? "Boss Role",
    quotedMessageId: msg.quoted_message_id,
    askerRole: typeof msg.asker_role === "string" && isRoleName(msg.asker_role)
      ? msg.asker_role
      : null,
    clientId,
  }, (error, failedClientId) => sendError(error, undefined, failedClientId));
}

// ═══════════════════════════════════════════════════════════
// MCP Endpoint — JSON-RPC over HTTP
// ═══════════════════════════════════════════════════════════

const MCP_TOOLS = [
  {
    name: "set_final_body",
    description:
      "设置当前消息的最终展示正文。当你完成分析、准备向用户展示最终结果时调用此工具。" +
      "调用后，你的最终正文将替代流式过程作为消息的主要展示内容，" +
      "流式过程中的中间分析将被折叠。",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "最终展示给用户的正文内容（支持 Markdown）" },
        conversation_id: { type: "string", description: "当前对话 ID，从系统提示词中的 <mcp_context> 获取" },
        message_id: { type: "string", description: "当前消息 ID，从系统提示词中的 <mcp_context> 获取" },
      },
      required: ["text", "conversation_id", "message_id"],
    },
  },
];

const MCP_SERVER_INFO = { name: "snail-shell-final-body", version: "1.0.0" };

function registerMcpEndpoint(app: express.Express, store: ConversationStore): void {
  app.post("/mcp", (req, res) => {
    const body = req.body;
    if (!body || typeof body !== "object") {
      res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }

    const { method, params, id } = body;

    // notifications (no id) — silently handled
    if (method && id === undefined) {
      res.status(204).end();
      return;
    }

    let result: unknown;
    try {
      switch (method) {
        case "initialize":
          result = { capabilities: { tools: {} }, serverInfo: MCP_SERVER_INFO };
          break;
        case "tools/list":
          result = { tools: MCP_TOOLS };
          break;
        case "tools/call":
          result = handleMcpToolCall(store, params);
          break;
        default:
          res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
          return;
      }
    } catch (err) {
      res.json({ jsonrpc: "2.0", id, error: { code: -32603, message: `Internal error: ${err instanceof Error ? err.message : String(err)}` } });
      return;
    }

    res.json({ jsonrpc: "2.0", id, result });
  });
}

function handleMcpToolCall(store: ConversationStore, params: unknown): unknown {
  const p = params as Record<string, unknown> | null | undefined;
  if (!p || typeof p.name !== "string") {
    return { content: [{ type: "text", text: JSON.stringify({ error: "Invalid params" }) }] };
  }

  if (p.name !== "set_final_body") {
    return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${p.name}` }) }] };
  }

  const args = (p.arguments ?? {}) as Record<string, unknown>;
  const text = typeof args.text === "string" ? args.text.trim() : "";
  const conversationId = typeof args.conversation_id === "string" ? args.conversation_id : "";
  const messageId = typeof args.message_id === "string" ? args.message_id : "";

  if (!text) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "text is required and must be non-empty" }) }] };
  }
  if (!conversationId || !messageId) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "conversation_id and message_id are required" }) }] };
  }

  try {
    store.upsertMessageContext(Number(messageId), "mcp_final_body", text, conversationId);
    return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
  } catch (err) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }] };
  }
}
