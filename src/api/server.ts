import express from "express";
import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import { ProjectManager } from "../project/manager";
import { ArtifactStorageType, ArtifactType, ConversationKind, StageStatus, StageType } from "../persistence/store";
import { loadArtifactDefinitions, loadStageDefinitions } from "../meta";
import { logger } from "../logger";

function isConversationKind(value: string): value is ConversationKind {
  return ["discussion", "planning", "design", "implementation", "review", "bugfix"].includes(value);
}

function isArtifactType(value: string): value is ArtifactType {
  return Object.prototype.hasOwnProperty.call(loadArtifactDefinitions(), value);
}

function isArtifactStorageType(value: string): value is ArtifactStorageType {
  return ["markdown_file", "inline_text", "json_record", "external_ref"].includes(value);
}

function isStageStatus(value: string): value is StageStatus {
  return ["in_progress", "completed", "cancelled"].includes(value);
}

export function createServer(projectManager: ProjectManager): { app: express.Express; server: http.Server } {
  const app = express();
  app.use(express.json());

  const router = express.Router();

  router.get("/meta/stages", (_req, res) => {
    res.json(loadStageDefinitions());
  });

  router.get("/meta/artifacts", (_req, res) => {
    res.json(loadArtifactDefinitions());
  });

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
      logger.info("Project created", { projectId: result.project.id, stageId: result.stage.id, conversationId: result.conversation.id });
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

  router.post("/projects/:projectId/advance", (req, res) => {
    try {
      logger.info("Stage advance requested", { projectId: req.params.projectId });
      res.status(201).json(projectManager.completeStageAndAdvance(req.params.projectId));
    } catch (err: any) {
      logger.warn("Stage advance failed", { projectId: req.params.projectId, error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  router.patch("/stages/:stageId", (req, res) => {
    const updates: any = {};
    if (req.body?.status) {
      if (!isStageStatus(req.body.status)) {
        res.status(400).json({ error: "invalid stage status" });
        return;
      }
      updates.status = req.body.status;
    }
    if (Array.isArray(req.body?.formal_artifacts)) {
      updates.formal_artifacts = req.body.formal_artifacts;
    }
    if (req.body?.entered_at !== undefined) {
      updates.entered_at = req.body.entered_at;
    }
    if (req.body?.left_at !== undefined) {
      updates.left_at = req.body.left_at;
    }
    try {
      res.json(projectManager.updateStage(req.params.stageId, updates));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get("/projects/:projectId/conversations", (req, res) => {
    res.json(projectManager.listProjectConversations(req.params.projectId));
  });

  router.get("/stages/:stageId/conversations", (req, res) => {
    res.json(projectManager.listStageConversations(req.params.stageId));
  });

  router.post("/stages/:stageId/conversations", (req, res) => {
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
      const conversation = projectManager.createConversation(req.body.project_id, req.params.stageId, title, kind, from_conversation_ids, summary);
      logger.info("Conversation created", { conversationId: conversation.id, projectId: req.body.project_id, stageId: req.params.stageId });
      res.status(201).json(conversation);
    } catch (err: any) {
      logger.warn("Conversation creation failed", { projectId: req.body.project_id, stageId: req.params.stageId, error: err.message });
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

  router.get("/conversations/:conversationId/messages", (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    res.json(projectManager.getConversationMessages(req.params.conversationId, limit, offset));
  });

  router.post("/conversations/:conversationId/messages", async (req, res) => {
    const { content } = req.body ?? {};
    if (!content || typeof content !== "string") {
      res.status(400).json({ error: "content is required" });
      return;
    }
    try {
      logger.debug("Conversation message request", { conversationId: req.params.conversationId });
      res.json(await projectManager.sendMessage(req.params.conversationId, content));
    } catch (err: any) {
      logger.error("Conversation message failed", { conversationId: req.params.conversationId, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/stages/:stageId/artifacts", (req, res) => {
    res.json(projectManager.listStageArtifacts(req.params.stageId));
  });

  router.get("/conversations/:conversationId/artifacts", (req, res) => {
    res.json(projectManager.listConversationArtifacts(req.params.conversationId));
  });

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
        storage_type,
        { filePath: file_path, inlineContent: inline_content, externalRef: external_ref, metadata },
        status ?? "active"
      );
      logger.info("Artifact created", { artifactId: artifact.id, conversationId: req.params.conversationId, artifactType: artifact_type });
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
      logger.info("Stage formal artifacts updated", { stageId: req.params.stageId, artifactIds: artifact_ids });
      res.json(result);
    } catch (err: any) {
      logger.warn("Stage formal artifacts update failed", { stageId: req.params.stageId, error: err.message });
      res.status(404).json({ error: err.message });
    }
  });

  router.get("/snails", (_req, res) => {
    res.json(projectManager.listSnails());
  });

  app.use("/api", router);

  const server = http.createServer(app);
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

    ws.on("close", () => {
      logger.debug("WebSocket disconnected", { conversationId });
      conversationClients.get(conversationId)?.delete(ws);
    });

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "send_message") {
          logger.debug("WebSocket send_message received", { conversationId });
          projectManager.sendMessage(conversationId, msg.content).catch((err) => {
            logger.error("WebSocket send_message failed", { conversationId, error: err.message });
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "error", error: err.message }));
            }
          });
        }
      } catch {
        // ignore malformed messages
      }
    });
  });

  projectManager.on("agent-event", (conversationId: string, event: any) => {
    const clients = conversationClients.get(conversationId);
    if (!clients) return;
    const data = JSON.stringify({ type: "agent_event", event });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  });

  return { app, server };
}
