import type { MiddlewareHandler } from "hono";
import { upgradeWebSocket } from "@hono/node-server";
import { WebSocketServer } from "ws";
import type { CollaborationConsumer, CollaborationInput, StageTransitionSuggestion } from "@app/issue-collaboration/port";
import type { Message } from "@domain/message/model";

type StageSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

interface StageWebSocketBridge {
  server: WebSocketServer;
  route: MiddlewareHandler;
}

export function createStageWebSocketBridge(collaboration: CollaborationInput): StageWebSocketBridge {
  return {
    server: new WebSocketServer({ noServer: true }),
    route: upgradeWebSocket((c) => {
      const stageId = c.req.query("stage_id");
      let consumer: CollaborationConsumer | null = null;

      return {
        onOpen(_event, socket) {
          if (consumer) return;
          if (!stageId) {
            console.warn("[stage-events] rejected websocket without stage_id");
            socket.close(1008, "stage_id is required");
            return;
          }
          console.log(`[stage-events] connected stage=${stageId}`);
          consumer = createConsumer(socket);
          collaboration.registerConsumer(stageId, consumer);
        },
        onClose() {
          if (stageId && consumer) {
            console.log(`[stage-events] disconnected stage=${stageId}`);
            collaboration.unregisterConsumer(stageId, consumer);
          }
        },
      };
    }),
  };
}

function createConsumer(socket: StageSocket): CollaborationConsumer {
  return {
    onMessageStarted(_stageId, message) {
      send(socket, { type: "agent_event", event: { type: "message_started", ...toMessageEventBase(message) } });
    },
    onEvent(_stageId, event) {
      send(socket, { type: "agent_event", event: { type: "message_event_appended", message_id: event.message_id, event } });
    },
    onMessageCompleted(_stageId, message, context) {
      send(socket, { type: "agent_event", event: { type: "message_status_changed", message_id: message.id, status: message.status, context } });
    },
    onUserCalled(_stageId, message) {
      send(socket, { type: "agent_event", event: { type: "user_called", ...toMessageEventBase(message) } });
    },
    onStageTransitionSuggested(_stageId, suggestion) {
      send(socket, { type: "agent_event", event: { type: "stage_transition_suggested", suggestion: toSuggestionPayload(suggestion) } });
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

function send(socket: StageSocket, payload: unknown): void {
  socket.send(JSON.stringify(payload));
}
