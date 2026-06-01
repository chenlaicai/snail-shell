import express from "express";
import http from "http";
import fs from "fs";
import path from "path";
import { WebSocket, WebSocketServer } from "ws";
import type { WorkspaceManager } from "../../workspace-workflow/manager";
import { listPrompts } from "../../prompt-center";
import { listSkills } from "../../skill-center";
import type { SnailDen } from "../../snail-den";
import { logger } from "../../logger";
import { ConversationGateway } from "../gateway";
import type { ConversationStore } from "../../persistence/store";
import { registerFeatureRoutes } from "./feature-routes";
import { registerEvolutionRoutes } from "./evolution-routes";
import { registerKnowledgeRoutes } from "./knowledge-routes";
import { registerLobbyRoutes } from "./lobby-routes";
import { isConversationKind, isRoleName } from "./validation";
import { permissionStore } from "../../agent/permission-store";
import { loadSnailConfig } from "../../workspace-workflow/snail-loader";

/** 校验 workspace_root 必须为绝对路径且不含 .. 遍历 */
function validateWorkspaceRoot(root: string): string | null {
  if (!path.isAbsolute(root)) return "workspace_root must be an absolute path";
  const normalized = path.normalize(root);
  if (normalized.includes("..")) return "workspace_root must not contain path traversal";
  return null;
}
import type { LobbySessionStore } from "../../lobby/session-store";
import type { LobbySession } from "../../lobby/types";

interface LobbyIntegration {
  sessionStore: LobbySessionStore;
  onSessionCleanup?: (session: LobbySession) => void;
}

export function createServer(workspaceManager: WorkspaceManager, snailDen: SnailDen, store: ConversationStore, conversationGateway = new ConversationGateway(workspaceManager), lobby?: LobbyIntegration): { app: express.Express; server: http.Server } {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  registerRoutes(router, workspaceManager, snailDen, conversationGateway, store, lobby);
  app.use("/api", router);

  registerMcpEndpoint(app, store);

  const server = http.createServer(app);
  bindWebSocketServer(server, conversationGateway);

  return { app, server };
}

function registerRoutes(router: express.Router, workspaceManager: WorkspaceManager, snailDen: SnailDen, conversationGateway: ConversationGateway, store: ConversationStore, lobby?: LobbyIntegration): void {
  registerMetaRoutes(router, snailDen);
  registerWorkspaceRoutes(router, workspaceManager, snailDen);
  registerConversationRoutes(router, workspaceManager, conversationGateway, store);
  registerRoleRoutes(router, workspaceManager);
  registerEvolutionRoutes(router, workspaceManager);
  registerKnowledgeRoutes(router, workspaceManager);
  if (lobby) registerLobbyRoutes(router, lobby.sessionStore, lobby.onSessionCleanup);
}

function registerMetaRoutes(router: express.Router, snailDen: SnailDen): void {
  router.get("/meta/prompts", (_req, res) => {
    res.json(listPrompts().map((prompt) => ({
      ...prompt,
      filePath: prompt.filePath.replace(`${process.cwd()}/`, ""),
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

  /** 读取 .mcp.json 中所有已配置的 MCP server，供前端 MCPs 目录展示。 */
  router.get("/meta/mcps", (_req, res) => {
    const mcpJsonPath = path.join(process.cwd(), ".mcp.json");
    try {
      if (!fs.existsSync(mcpJsonPath)) { res.json([]); return; }
      const parsed = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8"));
      const servers = (typeof parsed.mcpServers === "object" && parsed.mcpServers !== null) ? parsed.mcpServers : {};
      res.json(Object.entries(servers).map(([name, config]) => ({ name, ...(config as Record<string, unknown>) })));
    } catch {
      res.json([]);
    }
  });
}

function registerWorkspaceRoutes(router: express.Router, workspaceManager: WorkspaceManager, snailDen: SnailDen): void {
  registerFeatureRoutes(router, workspaceManager);
  registerSnailRoutes(router, workspaceManager);

  /** 校验 role_bindings 格式：每个值必须为非空字符串或非空字符串数组。 */
  function validateRoleBindings(role_bindings: unknown): string | null {
    if (!role_bindings || typeof role_bindings !== "object" || Array.isArray(role_bindings)) {
      return "role_bindings is required and must be an object mapping role keys to snail template IDs";
    }
    for (const [roleKey, templateId] of Object.entries(role_bindings)) {
      const templateIds = Array.isArray(templateId) ? templateId : [templateId];
      for (const tid of templateIds) {
        if (typeof tid !== "string" || !tid) {
          return `role_bindings["${roleKey}"] must contain non-empty template ID strings`;
        }
        if (!snailDen.getTemplate(tid)) {
          return `role_bindings["${roleKey}"] references unknown template "${tid}". Available: ${snailDen.listTemplates().map((t: any) => t.id).join(", ")}`;
        }
      }
    }
    return null;
  }

  router.get("/workspaces", (req, res) => {
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    res.json(workspaceManager.listWorkspaces(limit, offset));
  });

  router.post("/workspaces", (req, res) => {
    const { name, summary, workspace_root, sop_id, role_bindings, load_from_snail } = req.body ?? {};
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required" });
      return;
    }

    if (workspace_root && typeof workspace_root === "string") {
      const pathError = validateWorkspaceRoot(workspace_root);
      if (pathError) { res.status(400).json({ error: pathError }); return; }
    }

    if (!sop_id || typeof sop_id !== "string") {
      res.status(400).json({ error: "sop_id is required" });
      return;
    }

    // 如果从 .snail 加载，role_bindings 可以为空
    if (!load_from_snail) {
      const bindingsError = validateRoleBindings(role_bindings);
      if (bindingsError) { res.status(400).json({ error: bindingsError }); return; }
    }

    try {
      const result = workspaceManager.createWorkspace(name, {
        summary,
        workspaceRoot: workspace_root,
        sopId: sop_id,
        roleBindings: role_bindings || {},
        loadFromSnail: Boolean(load_from_snail),
      });
      logger.debug("Workspace created", { workspaceId: result.workspace.id, featureId: result.feature.id, stageId: result.stage.id, conversationId: result.conversation.id, loadFromSnail: Boolean(load_from_snail) });
      res.status(201).json(result);
    } catch (err: any) {
      logger.warn("Workspace creation failed", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  router.get("/workspaces/:workspaceId", (req, res) => {
    const workspace = workspaceManager.getWorkspace(req.params.workspaceId);
    if (!workspace) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }
    res.json(workspace);
  });

  router.get("/workspaces/:workspaceId/stages", (req, res) => {
    res.json(workspaceManager.listStages(req.params.workspaceId));
  });

  router.get("/workspaces/:workspaceId/features", (req, res) => {
    res.json(workspaceManager.listFeatures(req.params.workspaceId));
  });

  router.get("/workspaces/:workspaceId/conversations", (req, res) => {
    res.json(workspaceManager.listWorkspaceConversations(req.params.workspaceId));
  });

  registerSopRoutes(router, workspaceManager);
}

function registerSnailRoutes(router: express.Router, workspaceManager: WorkspaceManager): void {
  router.post("/workspaces/detect-snail", (req, res) => {
    const { workspace_root } = req.body ?? {};
    if (!workspace_root || typeof workspace_root !== "string") {
      res.status(400).json({ error: "workspace_root is required" });
      return;
    }
    const pathError = validateWorkspaceRoot(workspace_root);
    if (pathError) { res.status(400).json({ error: pathError }); return; }
    try {
      const hasSnail = workspaceManager.hasSnailConfig(workspace_root);
      let config = null;
      if (hasSnail) {
        config = loadSnailConfig(workspace_root);
      }
      res.json({ has_snail: hasSnail, config });
    } catch (err: any) {
      logger.warn("Failed to detect .snail directory", { error: err.message, workspaceRoot: workspace_root });
      /** 不向客户端暴露服务器端文件路径，仅返回错误类型 */
      res.status(400).json({ error: "Failed to read .snail configuration" });
    }
  });

  router.post("/workspaces/:workspaceId/load-snail", (req, res) => {
    const workspace = workspaceManager.getWorkspace(req.params.workspaceId);
    if (!workspace) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }
    try {
      const result = workspaceManager.loadWorkspaceFromSnail(req.params.workspaceId, workspace.workspace_root);
      res.json({ success: result, message: "Workspace config loaded from .snail directory" });
    } catch (err: any) {
      logger.warn("Failed to load workspace from .snail", { error: err.message, workspaceId: req.params.workspaceId });
      /** 不向客户端暴露服务器端文件路径 */
      res.status(400).json({ error: "Failed to load .snail configuration" });
    }
  });
}

function registerSopRoutes(router: express.Router, workspaceManager: WorkspaceManager): void {
  router.get("/sops", (req, res) => {
    const source = req.query.source as "platform" | "workspace" | undefined;
    res.json(workspaceManager.listSops(source === "platform" || source === "workspace" ? source : undefined));
  });

  router.get("/sops/:sopId", (req, res) => {
    const sop = workspaceManager.getSop(req.params.sopId);
    if (!sop) { res.status(404).json({ error: "SOP not found" }); return; }
    const stageDefinitions = workspaceManager.listSopStageDefinitionsWithRoles(sop.id);
    res.json({ ...sop, stage_definitions: stageDefinitions, transitions: workspaceManager.getSopTransitions(sop.id) });
  });

  router.get("/workspaces/:workspaceId/sops", (req, res) => {
    res.json(workspaceManager.listWorkspaceSops(req.params.workspaceId));
  });

  router.post("/workspaces/:workspaceId/sops", (req, res) => {
    const { sop_id, is_default, role_bindings } = req.body ?? {};
    if (!sop_id || typeof sop_id !== "string") { res.status(400).json({ error: "sop_id is required" }); return; }
    try {
      const result = workspaceManager.createWorkspaceSop({ workspaceId: req.params.workspaceId, sopId: sop_id, isDefault: Boolean(is_default), roleBindings: role_bindings ?? {} });
      res.status(201).json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch("/workspaces/:workspaceId/sops/:sopId", (req, res) => {
    const { is_default, role_bindings } = req.body ?? {};
    try {
      const result = workspaceManager.updateWorkspaceSop(req.params.workspaceId, req.params.sopId, { isDefault: is_default !== undefined ? Boolean(is_default) : undefined, roleBindings: role_bindings });
      res.json(result);
    } catch (err: any) {
      res.status(err.message.includes("not found") ? 404 : 400).json({ error: err.message });
    }
  });

  router.delete("/workspaces/:workspaceId/sops/:sopId", (req, res) => {
    try {
      workspaceManager.deleteWorkspaceSop(req.params.workspaceId, req.params.sopId);
      res.status(204).send();
    } catch (err: any) {
      res.status(err.message.includes("not found") ? 404 : 409).json({ error: err.message });
    }
  });
}

function registerConversationRoutes(router: express.Router, workspaceManager: WorkspaceManager, conversationGateway: ConversationGateway, store: ConversationStore): void {
  registerConversationCreationRoutes(router, workspaceManager);
  registerConversationHistoryRoutes(router, workspaceManager, conversationGateway, store);
}

function registerConversationCreationRoutes(router: express.Router, workspaceManager: WorkspaceManager): void {
  router.post("/features/:featureId/stages/:stageId/conversations", (req, res) => {
    const { workspace_id, title, kind, from_conversation_ids, summary } = req.body ?? {};
    if (!workspace_id || typeof workspace_id !== "string") {
      res.status(400).json({ error: "workspace_id is required" });
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
      const conversation = workspaceManager.createConversation({
        workspaceId: req.body.workspace_id,
        featureId: req.params.featureId,
        stageId: req.params.stageId,
        title,
        kind,
        fromConversationIds: from_conversation_ids,
        summary,
      });
      logger.debug("Conversation created", { conversationId: conversation.id, workspaceId: req.body.workspace_id, featureId: req.params.featureId, stageId: req.params.stageId });
      res.status(201).json(conversation);
    } catch (err: any) {
      logger.warn("Conversation creation failed", { workspaceId: req.body.workspace_id, featureId: req.params.featureId, stageId: req.params.stageId, error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  router.get("/conversations/:conversationId", (req, res) => {
    const conversation = workspaceManager.getConversation(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json(conversation);
  });
}

function registerConversationHistoryRoutes(router: express.Router, workspaceManager: WorkspaceManager, conversationGateway: ConversationGateway, store: ConversationStore): void {
  registerConversationMessageReadRoutes(router, workspaceManager);
  registerConversationMessageWriteRoutes(router, workspaceManager, conversationGateway, store);
}

function registerConversationMessageReadRoutes(router: express.Router, workspaceManager: WorkspaceManager): void {
  router.get("/conversations/:conversationId/messages", (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    res.json(workspaceManager.getConversationMessages(req.params.conversationId, limit, offset));
  });

  router.get("/conversations/:conversationId/messages/page", (req, res) => {
    const limit = Number(req.query.limit) || 10;
    const offset = Number(req.query.offset) || 0;
    const before = req.query.before ? Number(req.query.before) : undefined;
    res.json(workspaceManager.getConversationMessagesPage(req.params.conversationId, { limit, offset, before }));
  });

  router.get("/conversations/:conversationId/messages/recent", (req, res) => {
    const limit = Number(req.query.limit) || 5;
    res.json(workspaceManager.getRecentConversationMessages(req.params.conversationId, limit));
  });

  router.get("/conversations/:conversationId/events", (req, res) => {
    const afterEventId = Number(req.query.after_event_id) || 0;
    res.json({ items: workspaceManager.getConversationEventsAfter(req.params.conversationId, afterEventId) });
  });

  router.post("/conversations/:conversationId/messages/by-ids", (req, res) => {
    const messageIds = Array.isArray(req.body?.message_ids)
      ? req.body.message_ids.map((value: unknown) => Number(value)).filter((value: number) => Number.isInteger(value))
      : [];
    if (messageIds.length === 0) {
      res.status(400).json({ error: "message_ids is required" });
      return;
    }
    res.json(workspaceManager.getConversationMessagesByIds(req.params.conversationId, messageIds));
  });

  router.get("/conversations/:conversationId/messages/window", (req, res) => {
    const anchorMessageId = Number(req.query.anchor_message_id);
    if (!Number.isInteger(anchorMessageId)) {
      res.status(400).json({ error: "anchor_message_id is required" });
      return;
    }
    const before = Number(req.query.before) || 2;
    const after = Number(req.query.after) || 2;
    res.json(workspaceManager.getConversationMessageWindow(req.params.conversationId, anchorMessageId, before, after));
  });

  router.get("/conversations/:conversationId/dispatch-state", (req, res) => {
    try {
      res.json(workspaceManager.getConversationDispatchState(req.params.conversationId));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get("/conversations/:conversationId/boss-mentions", (req, res) => {
    try {
      res.json(workspaceManager.getBossMentions(req.params.conversationId));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.post("/conversations/:conversationId/boss-mentions/ack", (req, res) => {
    try {
      res.json(workspaceManager.acknowledgeBossMentions(req.params.conversationId));
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
    res.json(workspaceManager.searchConversationHistory(req.params.conversationId, query, limit, offset));
  });
}

function registerConversationMessageWriteRoutes(router: express.Router, workspaceManager: WorkspaceManager, conversationGateway: ConversationGateway, store: ConversationStore): void {
  router.post("/conversations/:conversationId/messages/:messageId/interrupt", (req, res) => {
    try {
      const messageId = Number(req.params.messageId);
      if (!Number.isInteger(messageId)) {
        res.status(400).json({ error: "message_id must be an integer" });
        return;
      }
      res.json(workspaceManager.interruptMessage(req.params.conversationId, messageId));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.post("/conversations/:conversationId/messages/:messageId/approve-tool", createApproveToolHandler(workspaceManager, store));

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

function registerRoleRoutes(router: express.Router, workspaceManager: WorkspaceManager): void {
  router.get("/roles", (_req, res) => {
    res.json(workspaceManager.listRoles());
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

export function registerMcpEndpoint(app: express.Express, store: ConversationStore): void {
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

  // 验证 message 是否属于指定 conversation，防止跨会话/跨消息污染
  if (!store.getMessage(Number(messageId), conversationId)) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "message_id does not belong to conversation_id" }) }] };
  }

  try {
    store.upsertMessageContext(Number(messageId), "mcp_final_body", text, conversationId);
    return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
  } catch (err) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }] };
  }
}

function createApproveToolHandler(workspaceManager: WorkspaceManager, store: ConversationStore): express.RequestHandler {
  return async (req, res) => {
    try {
      const conversationId = req.params.conversationId as string;
      const messageId = Number(req.params.messageId as string);
      if (!Number.isInteger(messageId)) {
        res.status(400).json({ error: "message_id must be an integer" });
        return;
      }
      const { approved } = req.body ?? {};
      if (typeof approved !== "boolean") {
        res.status(400).json({ error: "approved must be a boolean" });
        return;
      }

      const pending = permissionStore.get(conversationId, messageId);
      if (!pending) {
        res.status(404).json({ error: "Permission request not found or expired" });
        return;
      }

      if (!approved) {
        store.updateMessageStatus(messageId, "failed");
        permissionStore.delete(conversationId, messageId);
        res.json({ approved: false, status: "denied" });
        return;
      }

      // 批准：重新发送原用户消息触发 agent retry
      // bypassPermissions + disallowedTools 模式下，deny list 通过 CLI 静态传入，
      // 不在 deny list 中的命令自动放行，无需 extraAllow 机制

      // 查找原用户消息事件，重新发送以触发 agent retry
      const originalMsg = store.getMessage(pending.originalUserMessageId, conversationId);
      if (originalMsg) {
        const originalEvents = store.getMessageEvents(pending.originalUserMessageId, conversationId);
        const textEvents = originalEvents
          .filter((evt) => evt.kind === "text" || evt.kind === "content_block")
          .map((evt) => ({ kind: evt.kind, payload: evt.payload, source: evt.source } as any));
        if (textEvents.length > 0) {
          await workspaceManager.sendStructuredMessage(
            conversationId,
            textEvents,
            { fromRole: pending.originalFromRole || pending.originalRoleName || "Boss Role" }
          );
        }
      }

      permissionStore.delete(conversationId, messageId);
      res.json({ approved: true, status: "retrying" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}
