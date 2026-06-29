/**
 * @deprecated Use unified-websocket.ts instead.
 * This file is kept for reference only.
 */
import type { MiddlewareHandler } from "hono";
import { upgradeWebSocket } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { getLogger } from "@infra/logger";
import type { CollaborationInput, WorkspaceConsumer } from "@app/issue-collaboration/port";

const log = getLogger({ module: "workspace-websocket" });

type WorkspaceSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

interface WorkspaceWebSocketBridge {
  server: WebSocketServer;
  route: MiddlewareHandler;
}

/** @deprecated Use createUnifiedWebSocketBridge from unified-websocket.ts */
export function createWorkspaceWebSocketBridge(collaboration: CollaborationInput): WorkspaceWebSocketBridge {
  return {
    server: new WebSocketServer({ noServer: true }),
    route: upgradeWebSocket((c) => {
      const workspaceId = c.req.query("workspace_id");
      let consumer: WorkspaceConsumer | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (workspaceId && consumer) {
          log.info({ workspaceId }, "disconnected");
          collaboration.unregisterWorkspaceConsumer(workspaceId, consumer);
          consumer = null;
        }
      };

      return {
        onOpen(_event, socket) {
          if (consumer) return;
          if (!workspaceId) {
            log.warn("rejected websocket without workspace_id");
            socket.close(1008, "workspace_id is required");
            return;
          }
          log.info({ workspaceId }, "connected");
          consumer = createConsumer(socket);
          collaboration.registerWorkspaceConsumer(workspaceId, consumer);
          heartbeatTimer = setInterval(() => {
            try {
              socket.send(JSON.stringify({ type: "heartbeat", ts: Date.now() }));
            } catch {
              socket.close(1001, "heartbeat failed");
              cleanup();
            }
          }, 30_000);
        },
        onClose() {
          cleanup();
        },
      };
    }),
  };
}

function createConsumer(socket: WorkspaceSocket): WorkspaceConsumer {
  return {
    onActivityStatusChanged(issueId, activityStatus, previousStatus) {
      send(socket, {
        type: "activity_status_changed",
        issue_id: issueId,
        activity_status: activityStatus,
        previous_status: previousStatus,
      });
    },
  };
}

function send(socket: WorkspaceSocket, payload: unknown): void {
  socket.send(JSON.stringify(payload));
}
