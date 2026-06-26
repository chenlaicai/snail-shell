import type { MiddlewareHandler } from "hono";
import { upgradeWebSocket } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { getLogger } from "@infra/logger";
import type { CollaborationConsumer, CollaborationInput, StageTransitionSuggestion } from "@app/issue-collaboration/port";
import type { Message } from "@domain/message/model";

const log = getLogger({ module: "websocket" });

type IssueSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

interface IssueWebSocketBridge {
  server: WebSocketServer;
  route: MiddlewareHandler;
}

export function createIssueWebSocketBridge(collaboration: CollaborationInput): IssueWebSocketBridge {
  return {
    server: new WebSocketServer({ noServer: true }),
    route: upgradeWebSocket((c) => {
      const issueId = c.req.query("issue_id");
      let consumer: CollaborationConsumer | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (issueId && consumer) {
          log.info({ issueId }, "disconnected");
          collaboration.unregisterIssueConsumer(issueId, consumer);
          consumer = null;
        }
      };

      return {
        onOpen(_event, socket) {
          if (consumer) return;
          if (!issueId) {
            log.warn("rejected websocket without issue_id");
            socket.close(1008, "issue_id is required");
            return;
          }
          log.info({ issueId }, "connected");
          consumer = createConsumer(issueId, socket, collaboration);
          collaboration.registerIssueConsumer(issueId, consumer);
          heartbeatTimer = setInterval(() => {
            try {
              socket.send(JSON.stringify({ type: "heartbeat", issue_id: issueId, ts: Date.now() }));
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

function createConsumer(issueId: string, socket: IssueSocket, collaboration: CollaborationInput): CollaborationConsumer {
  return {
    onMessageStarted(stageId, message) {
      send(socket, { type: "issue_event", issue_id: issueId, activity_status: collaboration.getActivityStatus(stageId), event: { type: "message_started", stage_id: stageId, ...toMessageEventBase(message) } });
    },
    onEvent(stageId, event) {
      send(socket, { type: "issue_event", issue_id: issueId, activity_status: collaboration.getActivityStatus(stageId), event: { type: "message_event_appended", stage_id: stageId, message_id: event.message_id, event } });
    },
    onMessageCompleted(stageId, message, context) {
      send(socket, { type: "issue_event", issue_id: issueId, activity_status: collaboration.getActivityStatus(stageId), event: { type: "message_status_changed", stage_id: stageId, message_id: message.id, status: message.status, context } });
    },
    onUserCalled(stageId, message) {
      send(socket, { type: "issue_event", issue_id: issueId, activity_status: collaboration.getActivityStatus(stageId), event: { type: "user_called", stage_id: stageId, ...toMessageEventBase(message) } });
    },
    onStageTransitionSuggested(stageId, suggestion) {
      send(socket, { type: "issue_event", issue_id: issueId, activity_status: collaboration.getActivityStatus(stageId), event: { type: "stage_transition_suggested", stage_id: stageId, suggestion: toSuggestionPayload(suggestion) } });
    },
  };
}

function toMessageEventBase(message: Message) {
  return {
    message_id: message.id,
    role: message.from_speaker === "user" ? "user" : "assistant",
    role_name: message.from_speaker,
    client_id: null,
    status: message.status,
  };
}

function toSuggestionPayload(suggestion: StageTransitionSuggestion) {
  return {
    stage_id: suggestion.stage_id,
    message_id: suggestion.message_id,
    from_speaker: suggestion.from_speaker,
    target_key: suggestion.target_key,
    reason: suggestion.reason,
    guard: suggestion.guard,
    artifacts: suggestion.artifacts,
    created_at: suggestion.created_at,
  };
}

function send(socket: IssueSocket, payload: unknown): void {
  try {
    socket.send(JSON.stringify(payload));
  } catch (error) {
    log.warn({ err: error, event: (payload as { type?: string })?.type }, "ws.send failed — socket likely closed");
  }
}
