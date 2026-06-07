import express from "express";
import { HUMAN_ROLE_NAME } from "../../shared/domain-types";
import http from "http";
import path from "path";
import { WebSocket, WebSocketServer } from "ws";
import type { WorkspaceManager } from "../../workspace-workflow/manager";
import type { SnailDen } from "../../snail-den";
import { logger } from "../../logger";
import { ConversationGateway } from "../gateway";
import type { ConversationStore } from "../../persistence/store";
import { registerEvolutionRoutes } from "./evolution-routes";
import { registerKnowledgeRoutes } from "./knowledge-routes";
import { registerLobbyRoutes } from "./lobby-routes";
import { isRoleName } from "./validation";
import { registerMetaRoutes } from "./meta-routes";
import { registerWorkspaceRoutes } from "./workspace-routes";
import { registerConversationRoutes } from "./conversation-routes";
import type { LobbySessionStore } from "../../lobby/session-store";
import type { LobbySession } from "../../shared/domain-types";

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
  registerWorkspaceRoutes(router, workspaceManager);
  registerConversationRoutes(router, workspaceManager, conversationGateway, store);
  registerEvolutionRoutes(router, workspaceManager);
  registerKnowledgeRoutes(router, workspaceManager);
  if (lobby) registerLobbyRoutes(router, lobby.sessionStore, lobby.onSessionCleanup);
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
