import express from "express";
import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import type { ProjectManager } from "../project/manager";
import type { ArtifactType } from "../persistence/store";
import { listPromptDocuments, loadArtifactDefinitions, loadStageDefinitions } from "../meta";
import { logger } from "../logger";
import { ConversationGateway } from "../conversation/gateway";
import { registerFeatureRoutes } from "./feature-routes";
import { registerKnowledgeRoutes } from "./knowledge-routes";
import { isArtifactStorageType, isArtifactType, isConversationKind, isSnailName } from "./validation";

export function createServer(projectManager: ProjectManager, conversationGateway = new ConversationGateway(projectManager)): { app: express.Express; server: http.Server } {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  registerRoutes(router, projectManager, conversationGateway);
  app.use("/api", router);

  const server = http.createServer(app);
  bindWebSocketServer(server, conversationGateway);

  return { app, server };
}

function registerRoutes(router: express.Router, projectManager: ProjectManager, conversationGateway: ConversationGateway): void {
  registerMetaRoutes(router);
  registerProjectRoutes(router, projectManager);
  registerConversationRoutes(router, projectManager, conversationGateway);
  registerArtifactRoutes(router, projectManager);
  registerKnowledgeRoutes(router, projectManager);
}

function registerMetaRoutes(router: express.Router): void {
  router.get("/meta/stages", (_req, res) => {
    res.json(loadStageDefinitions());
  });

  router.get("/meta/artifacts", (_req, res) => {
    res.json(loadArtifactDefinitions());
  });

  router.get("/meta/prompts", (_req, res) => {
    res.json(listPromptDocuments().map((prompt) => ({
      ...prompt,
      filePath: prompt.filePath.replace(`${process.cwd()}/`, ""),
    })));
  });
}

function registerProjectRoutes(router: express.Router, projectManager: ProjectManager): void {
  registerFeatureRoutes(router, projectManager);

  router.get("/projects", (req, res) => {
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    res.json(projectManager.listProjects(limit, offset));
  });

  router.post("/projects", (req, res) => {
    const { name, summary, kind } = req.body ?? {};
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required" });
      return;
    }
    try {
      const result = projectManager.createProject(name, summary, kind === "system_self" ? kind : "product_delivery");
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

function registerConversationRoutes(router: express.Router, projectManager: ProjectManager, conversationGateway: ConversationGateway): void {
  registerConversationCreationRoutes(router, projectManager);
  registerConversationHistoryRoutes(router, projectManager, conversationGateway);
  registerConversationArtifactRoutes(router, projectManager);
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
    const { content, events, from_snail, producer_snail, quoted_message_id, asker_snail, client_id } = req.body ?? {};
    try {
      logger.debug("Conversation message request", { conversationId: req.params.conversationId });
      const result = await conversationGateway.sendMessage(req.params.conversationId, {
        content,
        events,
        fromSnail: from_snail ?? producer_snail ?? "Boss Snail",
        quotedMessageId: quoted_message_id,
        askerSnail: typeof asker_snail === "string" && isSnailName(asker_snail) ? asker_snail : null,
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

function registerConversationArtifactRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.get("/stages/:stageId/artifacts", (req, res) => {
    res.json(projectManager.listStageArtifacts(req.params.stageId));
  });

  router.get("/conversations/:conversationId/artifacts", (req, res) => {
    res.json(projectManager.listConversationArtifacts(req.params.conversationId));
  });
}

function registerArtifactRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.post("/conversations/:conversationId/artifacts", (req, res) => {
    const { artifact_type, storage_type, file_path, inline_content, external_ref, metadata, status } = req.body ?? {};
    if (!artifact_type || typeof artifact_type !== "string" || !isArtifactType(artifact_type)) {
      res.status(400).json({ error: "artifact_type must be valid" });
      return;
    }
    if (storage_type !== undefined) {
      if (typeof storage_type !== "string" || !isArtifactStorageType(storage_type)) {
        res.status(400).json({ error: "storage_type must be valid" });
        return;
      }
    }
    try {
      const artifact = projectManager.createArtifact(
        req.params.conversationId,
        artifact_type,
        artifactDisplayTitle(artifact_type),
        {
          storageType: storage_type,
          options: { filePath: file_path, inlineContent: inline_content, externalRef: external_ref, metadata },
          status: status ?? "active",
        }
      );
      logger.debug("Artifact created", { artifactId: artifact.id, conversationId: req.params.conversationId, artifactType: artifact_type });
      res.status(201).json(artifact);
    } catch (err: any) {
      logger.warn("Artifact creation failed", { conversationId: req.params.conversationId, artifactType: artifact_type, error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  router.patch("/artifacts/:artifactId", (req, res) => {
    try {
      res.json(projectManager.updateArtifact(req.params.artifactId, req.body ?? {}));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.put("/stages/:stageId/formal-artifacts", (req, res) => {
    const { artifact_ids } = req.body ?? {};
    if (!Array.isArray(artifact_ids)) {
      res.status(400).json({ error: "artifact_ids must be an array" });
      return;
    }
    try {
      const result = projectManager.setStageFormalArtifacts(req.params.stageId, artifact_ids);
      logger.debug("Stage formal artifacts updated", { stageId: req.params.stageId, artifactIds: artifact_ids });
      res.json(result);
    } catch (err: any) {
      logger.warn("Stage formal artifacts update failed", { stageId: req.params.stageId, error: err.message });
      res.status(404).json({ error: err.message });
    }
  });

  router.get("/snails", (_req, res) => {
    res.json(projectManager.listSnails());
  });
}

function artifactDisplayTitle(artifactType: ArtifactType): string {
  return loadArtifactDefinitions()[artifactType]?.title ?? artifactType;
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
    fromSnail: msg.from_snail ?? msg.producer_snail ?? "Boss Snail",
    quotedMessageId: msg.quoted_message_id,
    askerSnail: typeof msg.asker_snail === "string" && isSnailName(msg.asker_snail) ? msg.asker_snail : null,
    clientId,
  }, (error, failedClientId) => sendError(error, undefined, failedClientId));
}
