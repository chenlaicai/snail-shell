import type { MiddlewareHandler } from "hono";
import { upgradeWebSocket } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { getLogger } from "@infra/logger";
import type {
  CollaborationPort,
  CollaborationConsumer,
  WorkspaceConsumer,
  StageTransitionSuggestion,
} from "@domain/collaboration/port";
import type { Message } from "@domain/message/model";
import { decodeWorkspaceId } from "@infra/http/workspace-id";

const log = getLogger({ module: "websocket" });

type Socket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

interface UnifiedWebSocketBridge {
  server: WebSocketServer;
  route: MiddlewareHandler;
}

interface RouteInfo {
  isIssueRoute: boolean;
  isWorkspaceRoute: boolean;
  issueId: string | null;
  workspaceId: string | null;
}

/** 统一 WebSocket bridge，单个 WSS 处理 /issue-events 和 /workspace-events 两个路由 */
export function createUnifiedWebSocketBridge(collaboration: CollaborationPort): UnifiedWebSocketBridge {
  const wss = new WebSocketServer({ noServer: true });

  return {
    server: wss,
    route: upgradeWebSocket((c) => {
      const routeInfo = parseRoute(c.req.url);

      if (!routeInfo.isIssueRoute && !routeInfo.isWorkspaceRoute) {
        return { onOpen(_event, socket) { socket.close(1008, "Unknown WebSocket route"); } };
      }

      return createRouteHandler(routeInfo, collaboration);
    }),
  };
}

function parseRoute(url: string): RouteInfo {
  const parsed = new URL(url);
  const isIssueRoute = parsed.pathname === "/issue-events";
  const isWorkspaceRoute = parsed.pathname === "/workspace-events";
  return {
    isIssueRoute,
    isWorkspaceRoute,
    issueId: isIssueRoute ? parsed.searchParams.get("issue_id") : null,
    workspaceId: isWorkspaceRoute ? parsed.searchParams.get("workspace_id") : null,
  };
}

function createRouteHandler(routeInfo: RouteInfo, collaboration: CollaborationPort) {
  let issueConsumer: CollaborationConsumer | null = null;
  let workspaceConsumer: WorkspaceConsumer | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (routeInfo.isIssueRoute && routeInfo.issueId && issueConsumer) {
      log.info({ issueId: routeInfo.issueId }, "issue-events disconnected");
      collaboration.unregisterIssueConsumer(routeInfo.issueId, issueConsumer);
      issueConsumer = null;
    }
    if (routeInfo.isWorkspaceRoute && routeInfo.workspaceId && workspaceConsumer) {
      const decodedWorkspacePath = decodeWorkspaceId(routeInfo.workspaceId);
      log.info({ workspaceId: routeInfo.workspaceId, workspacePath: decodedWorkspacePath }, "workspace-events disconnected");
      collaboration.unregisterWorkspaceConsumer(decodedWorkspacePath, workspaceConsumer);
      workspaceConsumer = null;
    }
  };

  return {
    onOpen(_event: unknown, socket: Socket) {
      if (routeInfo.isIssueRoute) {
        issueConsumer = handleIssueOpen(routeInfo.issueId, socket, collaboration, issueConsumer, cleanup);
        if (!issueConsumer) return;
      }
      if (routeInfo.isWorkspaceRoute) {
        workspaceConsumer = handleWorkspaceOpen(routeInfo.workspaceId, socket, collaboration, workspaceConsumer, cleanup);
        if (!workspaceConsumer) return;
      }
      heartbeatTimer = startHeartbeat(socket, routeInfo, cleanup);
    },
    onClose() { cleanup(); },
  };
}

function handleIssueOpen(
  issueId: string | null,
  socket: Socket,
  collaboration: CollaborationPort,
  existing: CollaborationConsumer | null,
  cleanup: () => void,
): CollaborationConsumer | null {
  if (existing) return existing;
  if (!issueId) {
    log.warn("rejected issue-events websocket without issue_id");
    socket.close(1008, "issue_id is required");
    return null;
  }
  log.info({ issueId }, "issue-events connected");
  const consumer = createIssueConsumer(issueId, socket, collaboration, cleanup);
  collaboration.registerIssueConsumer(issueId, consumer);
  return consumer;
}

function handleWorkspaceOpen(
  workspaceId: string | null,
  socket: Socket,
  collaboration: CollaborationPort,
  existing: WorkspaceConsumer | null,
  cleanup: () => void,
): WorkspaceConsumer | null {
  if (existing) return existing;
  if (!workspaceId) {
    log.warn("rejected workspace-events websocket without workspace_id");
    socket.close(1008, "workspace_id is required");
    return null;
  }
  const decodedWorkspacePath = decodeWorkspaceId(workspaceId);
  log.info({ workspaceId, workspacePath: decodedWorkspacePath }, "workspace-events connected");
  const consumer = createWorkspaceConsumer(socket, cleanup);
  collaboration.registerWorkspaceConsumer(decodedWorkspacePath, consumer);
  return consumer;
}

function startHeartbeat(socket: Socket, routeInfo: RouteInfo, onFail: () => void) {
  return setInterval(() => {
    try {
      socket.send(JSON.stringify({
        type: "heartbeat",
        ts: Date.now(),
        ...(routeInfo.isIssueRoute ? { issue_id: routeInfo.issueId } : {}),
      }));
    } catch {
      socket.close(1001, "heartbeat failed");
      onFail();
    }
  }, 30_000);
}

function createIssueConsumer(issueId: string, socket: Socket, collaboration: CollaborationPort, cleanup: () => void): CollaborationConsumer {
  const emit = (stageId: string, event: Record<string, unknown>, statusStageId?: string, noCleanup?: boolean) =>
    send(socket, { type: "issue_event", issue_id: issueId, activity_status: collaboration.getActivityStatus(statusStageId ?? stageId), event: { ...event, stage_id: stageId } }, noCleanup ? undefined : cleanup);
  return {
    onMessageStarted(stageId, message) { emit(stageId, { type: "message_started", ...toMessageEventBase(message) }); },
    onEvent(stageId, event) { emit(stageId, { type: "message_event_appended", message_id: event.message_id, event }); },
    onMessageCompleted(stageId, message, context) { emit(stageId, { type: "message_status_changed", message_id: message.id, status: message.status, context, ended_at: message.ended_at }); },
    onUserCalled(stageId, message) { emit(stageId, { type: "user_called", ...toMessageEventBase(message) }); },
    onStageTransitionSuggested(stageId, suggestion) { emit(stageId, { type: "stage_transition_suggested", suggestion: toSuggestionPayload(suggestion) }); },
    onAutoAdvanced(stageId, data) { emit(stageId, { type: "stage_changed", new_stage_id: data.to, from_key: data.from_key, to_key: data.to_key }, data.to, true); },
    onEvaluationResult(stageId, result) { emit(stageId, { type: "evaluation_result", action: result.action, reasons: result.reasons }); },
    onCleanupCompleted(cleanupIssueId, cleanupResult) { send(socket, { type: "issue_event", issue_id: cleanupIssueId, activity_status: "completed", event: { type: "cleanup_completed", issue_id: cleanupIssueId, cleanup: cleanupResult } }, cleanup); },
  };
}

function createWorkspaceConsumer(socket: Socket, cleanup: () => void): WorkspaceConsumer {
  return {
    onActivityStatusChanged(issueId, activityStatus, previousStatus) {
      send(socket, {
        type: "activity_status_changed",
        issue_id: issueId,
        activity_status: activityStatus,
        previous_status: previousStatus,
      }, cleanup);
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

function send(socket: Socket, payload: unknown, cleanup?: () => void): void {
  try {
    socket.send(JSON.stringify(payload));
  } catch (error) {
    log.warn({ err: error, event: (payload as { type?: string })?.type }, "ws.send failed — triggering cleanup");
    cleanup?.();
    socket.close();
  }
}
