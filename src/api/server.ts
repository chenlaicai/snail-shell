import express from "express";
import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import type { ProjectManager } from "../project/manager";
import { listPromptDocuments, loadArtifactDefinitions, loadStageDefinitions } from "../meta";
import { logger } from "../logger";
import { summarizeRuntimeError } from "../agent/runtime-error";
import { buildPlainTextEvent } from "../project/message-events";
import { registerFeatureRoutes } from "./feature-routes";
import { isArtifactStorageType, isArtifactType, isConversationKind, isSnailName } from "./validation";

export function createServer(projectManager: ProjectManager): { app: express.Express; server: http.Server } {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  registerRoutes(router, projectManager);
  app.use("/api", router);

  const server = http.createServer(app);
  bindWebSocketServer(server, projectManager);

  return { app, server };
}

const VALID_EVENT_KINDS = ["text", "content_block"];

interface PartValidationError {
  invalidTypes: string[];
  message: string;
  hint: string;
}

function validateMessageEvents(events: any[]): PartValidationError | null {
  const invalidParts = events.filter((p: any) =>
    p.kind && !VALID_EVENT_KINDS.includes(p.kind)
  );

  if (invalidParts.length > 0) {
    const invalidTypes = [...new Set(invalidParts.map((p: any) => p.kind))];
    return {
      invalidTypes,
      message: `Invalid message event kind(s): ${invalidTypes.join(", ")}. Supported kinds: ${VALID_EVENT_KINDS.join(", ")}`,
      hint: "External message input only supports content events."
    };
  }

  if (events.length === 0) {
    return {
      invalidTypes: [],
      message: "Messages must contain at least one content event",
      hint: "Send a text or content_block event."
    };
  }

  return null;
}

function registerRoutes(router: express.Router, projectManager: ProjectManager): void {
  registerMetaRoutes(router);
  registerProjectRoutes(router, projectManager);
  registerConversationRoutes(router, projectManager);
  registerArtifactRoutes(router, projectManager);
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

function registerConversationRoutes(router: express.Router, projectManager: ProjectManager): void {
  registerConversationCreationRoutes(router, projectManager);
  registerConversationHistoryRoutes(router, projectManager);
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

function registerConversationHistoryRoutes(router: express.Router, projectManager: ProjectManager): void {
  registerConversationMessageReadRoutes(router, projectManager);
  registerConversationMessageWriteRoutes(router, projectManager);
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

function registerConversationMessageWriteRoutes(router: express.Router, projectManager: ProjectManager): void {
  router.post("/conversations/:conversationId/messages", async (req, res) => {
    const { content, events, from_snail, producer_snail, quoted_message_id, asker_snail, client_id } = req.body ?? {};
    if (!content && !Array.isArray(events)) {
      res.status(400).json({ error: "content or events is required" });
      return;
    }
    try {
      logger.debug("Conversation message request", { conversationId: req.params.conversationId });

       let normalizedEvents: any[];

      if (Array.isArray(events)) {
        const validationError = validateMessageEvents(events);
        if (validationError) {
          res.status(400).json({
            error: validationError.message,
            hint: validationError.hint
          });
          return;
        }

        normalizedEvents = events;
      } else {
        normalizedEvents = [buildPlainTextEvent(content)];
      }

      res.json(await projectManager.sendStructuredMessage(
        req.params.conversationId,
        normalizedEvents,
        from_snail ?? producer_snail ?? "Boss Snail",
        Number.isInteger(quoted_message_id) ? quoted_message_id : null,
        typeof asker_snail === "string" && isSnailName(asker_snail) ? asker_snail : null,
        typeof client_id === "string" && client_id.trim() ? client_id.trim() : null
      ));
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
    const { artifact_type, title, storage_type, file_path, inline_content, external_ref, metadata, status } = req.body ?? {};
    if (!artifact_type || typeof artifact_type !== "string" || !isArtifactType(artifact_type)) {
      res.status(400).json({ error: "artifact_type must be valid" });
      return;
    }
    if (!title || typeof title !== "string") {
      res.status(400).json({ error: "title is required" });
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
        title,
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

function bindWebSocketServer(server: http.Server, projectManager: ProjectManager): void {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const conversationClients = new Map<string, Set<WebSocket>>();

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

    const afterEventId = Number(url.searchParams.get("after_event_id")) || 0;
    const subscribedEventId = projectManager.getLastConversationEventId(conversationId);
    if (afterEventId > 0 && ws.readyState === WebSocket.OPEN) {
      for (const event of projectManager.getConversationEventsBetween(conversationId, afterEventId, subscribedEventId)) {
        const data = JSON.stringify({ type: "agent_event", conversation_id: conversationId, event: { type: "message_event_appended", conversation_id: conversationId, message_id: event.message_id, snail_name: event.message_from_snail, event } });
        ws.send(data);
      }
    }

    ws.on("close", () => {
      logger.debug("WebSocket disconnected", { conversationId });
      conversationClients.get(conversationId)?.delete(ws);
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
          handleWebSocketSendMessage(projectManager, conversationId, msg, sendError);
        }
      } catch {
        // ignore malformed messages
      }
    });
  });

  projectManager.on("agent-event", (conversationId: string, event: any) => {
    const clients = conversationClients.get(conversationId);
    if (!clients) return;
    const data = JSON.stringify({ type: "agent_event", conversation_id: conversationId, event: { ...event, conversation_id: conversationId } });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  });

  projectManager.on("conversation-badge", (payload: { conversation_id: string; stage_id: string; boss_pending_count: number }) => {
    const clients = conversationClients.get(payload.conversation_id);
    if (!clients) return;
    const data = JSON.stringify({ type: "conversation_badge", payload });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  });
}

function handleWebSocketSendMessage(
  projectManager: ProjectManager,
  conversationId: string,
  msg: any,
  sendError: (error: string, hint?: string, clientId?: string | null) => void
): void {
  logger.debug("WebSocket send_message received", { conversationId });
  const fromSnail = msg.from_snail ?? msg.producer_snail ?? "Boss Snail";
  const quotedMessageId = Number.isInteger(msg.quoted_message_id) ? msg.quoted_message_id : null;
  const askerSnail = typeof msg.asker_snail === "string" && isSnailName(msg.asker_snail) ? msg.asker_snail : null;
  const clientId = typeof msg.client_id === "string" && msg.client_id.trim() ? msg.client_id.trim() : null;

  if (Array.isArray(msg.events)) {
    const validationError = validateMessageEvents(msg.events);
    if (validationError) {
      logger.warn("WebSocket message validation failed", { conversationId, invalidTypes: validationError.invalidTypes });
      sendError(validationError.message, validationError.hint, clientId);
      return;
    }

    projectManager.sendStructuredMessage(conversationId, msg.events, fromSnail, quotedMessageId, askerSnail, clientId).catch((err) => {
      logger.error("WebSocket send_message failed", { conversationId, error: err.message, stack: err.stack });
      sendError(summarizeRuntimeError(err.message), undefined, clientId);
    });
    return;
  }

  const normalizedEvents = [buildPlainTextEvent(msg.content)];
  projectManager.sendStructuredMessage(conversationId, normalizedEvents, fromSnail, quotedMessageId, askerSnail, clientId).catch((err) => {
    logger.error("WebSocket send_message failed", { conversationId, error: err.message });
    sendError(summarizeRuntimeError(err.message), undefined, clientId);
  });
}
