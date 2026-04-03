import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { SessionManager } from "../session/manager";

export function createServer(sessionManager: SessionManager): { app: express.Express; server: http.Server } {
  const app = express();
  app.use(express.json());

  const router = express.Router();

  // Create session
  router.post("/sessions", (req, res) => {
    const { title } = req.body ?? {};
    const session = sessionManager.createSession(title);
    res.status(201).json(session);
  });

  // List sessions
  router.get("/sessions", (req, res) => {
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const sessions = sessionManager.listSessions(limit, offset);
    res.json(sessions);
  });

  // Get session detail
  router.get("/sessions/:id", (req, res) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(session);
  });

  // Send message and get agent reply (non-streaming fallback)
  router.post("/sessions/:id/messages", async (req, res) => {
    const { content } = req.body;
    if (!content || typeof content !== "string") {
      res.status(400).json({ error: "content is required" });
      return;
    }
    try {
      const result = await sessionManager.sendMessage(req.params.id, content);
      res.json(result);
    } catch (err: any) {
      if (err.message?.includes("Session not found")) {
        res.status(404).json({ error: err.message });
      } else {
        res.status(500).json({ error: err.message });
      }
    }
  });

  // Get message history
  router.get("/sessions/:id/messages", (req, res) => {
    try {
      const limit = Number(req.query.limit) || 100;
      const offset = Number(req.query.offset) || 0;
      const messages = sessionManager.getHistory(req.params.id, limit, offset);
      res.json(messages);
    } catch {
      res.status(404).json({ error: "Session not found" });
    }
  });

  // Delete session
  router.delete("/sessions/:id", (req, res) => {
    sessionManager.deleteSession(req.params.id);
    res.status(204).send();
  });

  // Create requirement
  router.post("/sessions/:sessionId/requirements", (req, res) => {
    const { title, description } = req.body ?? {};
    if (!title || typeof title !== "string") {
      res.status(400).json({ error: "title is required" });
      return;
    }
    try {
      const requirement = sessionManager.createRequirement(req.params.sessionId, title, description);
      res.status(201).json(requirement);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // List requirements
  router.get("/sessions/:sessionId/requirements", (req, res) => {
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const requirements = sessionManager.listRequirements(req.params.sessionId, limit, offset);
    res.json(requirements);
  });

  // Get requirement
  router.get("/sessions/:sessionId/requirements/:id", (req, res) => {
    const id = Number(req.params.id);
    const requirement = sessionManager.getRequirement(id);
    if (!requirement) {
      res.status(404).json({ error: "Requirement not found" });
      return;
    }
    res.json(requirement);
  });

  // Update requirement status
  router.patch("/sessions/:sessionId/requirements/:id/status", (req, res) => {
    const id = Number(req.params.id);
    const { status } = req.body ?? {};
    if (!status || !["pending", "in_progress", "completed", "cancelled"].includes(status)) {
      res.status(400).json({ error: "status must be one of: pending, in_progress, completed, cancelled" });
      return;
    }
    try {
      sessionManager.updateRequirementStatus(id, status as any);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update requirement commit
  router.patch("/sessions/:sessionId/requirements/:id/commit", (req, res) => {
    const id = Number(req.params.id);
    const { commit_hash } = req.body ?? {};
    if (!commit_hash || typeof commit_hash !== "string") {
      res.status(400).json({ error: "commit_hash is required" });
      return;
    }
    try {
      sessionManager.updateRequirementCommit(id, commit_hash);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete requirement
  router.delete("/sessions/:sessionId/requirements/:id", (req, res) => {
    const id = Number(req.params.id);
    sessionManager.deleteRequirement(id);
    res.status(204).send();
  });

  // List skills
  router.get("/skills", (req, res) => {
    const skills = sessionManager.listSkills();
    res.json(skills);
  });

  // Execute skill
  router.post("/sessions/:sessionId/skills/:skillName", async (req, res) => {
    const { skillName } = req.params;
    const args = req.body ?? {};
    try {
      const result = await sessionManager.executeSkill(req.params.sessionId, skillName, args);
      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });


  app.use("/api", router);

  const server = http.createServer(app);

  // WebSocket for streaming
  const wss = new WebSocketServer({ server, path: "/ws" });

  const sessionClients = new Map<string, Set<WebSocket>>();

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("session_id");

    if (!sessionId) {
      ws.close(4000, "session_id required");
      return;
    }

    if (!sessionClients.has(sessionId)) {
      sessionClients.set(sessionId, new Set());
    }
    sessionClients.get(sessionId)!.add(ws);

    ws.on("close", () => {
      sessionClients.get(sessionId)?.delete(ws);
    });

    // Handle incoming messages from client
    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "send_message") {
          // Trigger the message send (events will be pushed via sessionManager events)
          sessionManager.sendMessage(sessionId, msg.content).catch((err) => {
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

  // Forward session events to WebSocket clients
  sessionManager.on("agent-event", (sid: string, event: any) => {
    const clients = sessionClients.get(sid);
    if (clients) {
      const data = JSON.stringify({ type: "agent_event", event });
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      }
    }
  });

  sessionManager.on("permission-required", (sid: string, request: any) => {
    const clients = sessionClients.get(sid);
    if (clients) {
      const data = JSON.stringify({ type: "permission_required", request });
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      }
    }
  });

  return { app, server };
}
