import express from "express";
import { HUMAN_ROLE_NAME } from "../../shared/domain-types";
import http from "http";
import path from "path";
import { WebSocket, WebSocketServer } from "ws";
import type { WorkspaceManager } from "../../workspace-workflow/manager";
import { listPrompts } from "../../prompt-center";
import { listSkills } from "../../skill-center";
import type { SnailDen } from "../../snail-den";
import { logger } from "../../logger";
import { ConversationGateway } from "../gateway";
import type { ConversationStore } from "../../persistence/store";
import { registerIssueRoutes } from "./issue-routes";
import { registerEvolutionRoutes } from "./evolution-routes";
import { registerKnowledgeRoutes } from "./knowledge-routes";
import { registerLobbyRoutes } from "./lobby-routes";
import { isRoleName } from "./validation";
import { permissionStore } from "../../agent/permission-store";
import { loadWorkspaceConfigOnly } from "../../workspace-workflow/snail-loader";
import { collectActiveMcpServers, getBuiltinMcpNames } from "../../mcp/registry";

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

  // Serve React app (static files + catch-all for client-side routing)
  const webDist = path.join(__dirname, "../../../../dist/web");
  let indexHtml = "";
  require("fs").promises.readFile(path.join(webDist, "index.html"), "utf8")
    .then((html: string) => { indexHtml = html; })
    .catch((err: Error) => { logger.error("Failed to load index.html", { error: err.message }); });
  app.use(express.static(webDist));
  app.use((_req, res) => {
    if (!indexHtml) { res.status(503).send("Loading..."); return; }
    res.type("html").send(indexHtml);
  });

  const server = http.createServer(app);
  bindWebSocketServer(server, conversationGateway, workspaceManager);

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

  /** 读取所有已配置的 MCP server（平台 + workspace 合并），供前端 MCPs 目录展示。 */
  router.get("/meta/mcps", (req, res) => {
    try {
      const workspaceRoot = typeof req.query.workspace_root === "string" ? req.query.workspace_root : undefined;
      const allServers = collectActiveMcpServers(workspaceRoot);
      const builtinNames = getBuiltinMcpNames();
      const all = allServers.map((s) => ({ ...s, builtin: builtinNames.has(s.name) }));
      res.json(all);
    } catch {
      res.json([]);
    }
  });
}

function registerWorkspaceRoutes(router: express.Router, workspaceManager: WorkspaceManager, _snailDen: SnailDen): void {
  registerIssueRoutes(router, workspaceManager);
  registerSnailRoutes(router, workspaceManager);

  router.get("/workspaces", (req, res) => {
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    res.json(workspaceManager.listWorkspaces(limit, offset));
  });

  router.post("/workspaces", (req, res) => {
    const { name, summary, workspace_root, sop_id, role_snail_mapping, load_from_snail } = req.body ?? {};
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

    // 如果从 .snail 加载，role_snail_mapping 可以为空
    if (!load_from_snail) {
      if (!sop_id || typeof sop_id !== "string") {
        res.status(400).json({ error: "sop_id is required" });
        return;
      }
    }

    try {
      const result = workspaceManager.createWorkspace(name, {
        summary,
        workspaceRoot: workspace_root,
        sopId: sop_id,
        roleSnailMapping: role_snail_mapping || {},
        loadFromSnail: Boolean(load_from_snail),
      });
      logger.debug("Workspace created", { workspaceId: result.workspace.id, issueId: result.issue.id, stageId: result.stage.id, conversationId: result.conversation.id, loadFromSnail: Boolean(load_from_snail) });
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

  router.get("/workspaces/:workspaceId/issues", (req, res) => {
    res.json(workspaceManager.listIssues(req.params.workspaceId));
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
        config = loadWorkspaceConfigOnly(workspace_root);
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

  router.post("/sops", (req, res) => {
    const { key, name, description, first_stage, shared_handbook, stage_definitions, transitions } = req.body ?? {};
    if (!key || typeof key !== "string") { res.status(400).json({ error: "key is required" }); return; }
    if (!name || typeof name !== "string") { res.status(400).json({ error: "name is required" }); return; }
    if (!Array.isArray(stage_definitions) || stage_definitions.length === 0) { res.status(400).json({ error: "stage_definitions is required and must not be empty" }); return; }
    try {
      const sop = workspaceManager.createPlatformSop({ key, name, description, first_stage, shared_handbook, stage_definitions, transitions });
      res.status(201).json(sop);
    } catch (err: any) {
      res.status(err.message.includes("already exists") ? 409 : 400).json({ error: err.message });
    }
  });

  router.patch("/sops/:sopId", (req, res) => {
    const { name, description, first_stage, shared_handbook, stage_definitions, transitions } = req.body ?? {};
    if (stage_definitions !== undefined && (!Array.isArray(stage_definitions) || stage_definitions.length === 0)) {
      res.status(400).json({ error: "stage_definitions must be a non-empty array" }); return;
    }
    try {
      const sop = workspaceManager.updatePlatformSop(req.params.sopId, { name, description, first_stage, shared_handbook, stage_definitions, transitions });
      res.json(sop);
    } catch (err: any) {
      res.status(err.message.includes("not found") ? 404 : 400).json({ error: err.message });
    }
  });

  router.delete("/sops/:sopId", (req, res) => {
    try {
      const affectedWorkspaces = workspaceManager.deletePlatformSop(req.params.sopId);
      res.status(200).json({ affected_workspaces: affectedWorkspaces });
    } catch (err: any) {
      res.status(err.message.includes("not found") ? 404 : 400).json({ error: err.message });
    }
  });
}

function registerConversationRoutes(router: express.Router, workspaceManager: WorkspaceManager, conversationGateway: ConversationGateway, store: ConversationStore): void {
  router.get("/conversations/:conversationId", (req, res) => {
    const conversation = workspaceManager.getConversation(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json(conversation);
  });
  registerConversationHistoryRoutes(router, workspaceManager, conversationGateway, store);
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
    const fromRole = from_role ?? producer_role ?? HUMAN_ROLE_NAME;
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

function bindWebSocketServer(server: http.Server, conversationGateway: ConversationGateway, workspaceManager: WorkspaceManager): void {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const conversationClients = new Map<string, Set<WebSocket>>();
  const conversationUnsubscribers = new Map<string, () => void>();

  /** 向指定 conversation 的所有 WebSocket 客户端广播消息。 */
  function broadcastToConversation(conversationId: string, data: string): void {
    const clients = conversationClients.get(conversationId);
    if (!clients) return;
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }

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

  conversationGateway.onBadge((payload: { conversation_id: string; issue_id: string | null; stage_id: string | null; boss_pending_count: number }) => {
    broadcastToConversation(payload.conversation_id, JSON.stringify({ type: "conversation_badge", payload }));
  });

  /** AI 提议阶段转移时，向相关 conversation 的所有客户端广播建议。 */
  workspaceManager.on("stage-suggestion", (suggestion: { issueId: string; fromStageKey: string; toStageKey: string; reason: string | null; suggestedAt: string }) => {
    const conversations = workspaceManager.listIssueConversations(suggestion.issueId);
    const data = JSON.stringify({ type: "stage_suggestion", payload: suggestion });
    for (const conv of conversations) {
      broadcastToConversation(conv.id, data);
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
    fromRole: msg.from_role ?? msg.producer_role ?? HUMAN_ROLE_NAME,
    quotedMessageId: msg.quoted_message_id,
    askerRole: typeof msg.asker_role === "string" && isRoleName(msg.asker_role)
      ? msg.asker_role
      : null,
    clientId,
  }, (error, failedClientId) => sendError(error, undefined, failedClientId));
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
            { fromRole: pending.originalFromRole || pending.originalRoleName || HUMAN_ROLE_NAME }
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
