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

  // Permission response
  router.post("/permissions/:toolUseId", (req, res) => {
    const { decision } = req.body;
    if (decision !== "allow" && decision !== "deny") {
      res.status(400).json({ error: "decision must be 'allow' or 'deny'" });
      return;
    }
    const ok = sessionManager.respondToPermission(req.params.toolUseId, decision);
    if (!ok) {
      res.status(404).json({ error: "No pending permission for this tool_use_id" });
      return;
    }
    res.json({ ok: true });
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
