import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../queries/keys";
import type { MessageWithEvents, WsAgentEvent, WsServerMessage, ToolPermissionRequest } from "../types";

interface PendingPermission {
  messageId: number;
  roleName: string;
  request: ToolPermissionRequest;
}

export function useWebSocket(
  conversationId: string | null,
  onPermissionRequired?: (perm: PendingPermission) => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const qc = useQueryClient();
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();
  const backoffRef = useRef(1000);
  const maxRetries = 20;
  const retriesRef = useRef(0);
  const statusRef = useRef<"connected" | "disconnected" | "reconnecting">("disconnected");

  const connect = useCallback(() => {
    if (!conversationId) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?conversation_id=${conversationId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      backoffRef.current = 1000;
      retriesRef.current = 0;
      statusRef.current = "connected";
    };
    ws.onmessage = (e) => {
      try {
        const msg: WsServerMessage = JSON.parse(e.data);
        handleMessage(msg, qc, conversationId, onPermissionRequired);
      } catch (err) {
        console.error("[WS] Failed to parse message:", err);
      }
    };
    ws.onclose = () => {
      statusRef.current = "reconnecting";
      if (retriesRef.current >= maxRetries) {
        statusRef.current = "disconnected";
        return;
      }
      retriesRef.current++;
      reconnectRef.current = setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 2, 30000);
        connect();
      }, backoffRef.current);
    };
    ws.onerror = () => ws.close();
  }, [conversationId, qc, onPermissionRequired]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { wsRef, send, getStatus: () => statusRef.current };
}

function handleMessage(
  msg: WsServerMessage,
  qc: ReturnType<typeof useQueryClient>,
  conversationId: string,
  onPermissionRequired?: (perm: PendingPermission) => void,
) {
  switch (msg.type) {
    case "agent_event":
      handleAgentEvent(msg, qc, conversationId, onPermissionRequired);
      break;
    case "error":
      console.error("[WS Error]", msg.error, msg.hint);
      break;
    case "conversation_badge":
      qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(msg.payload.conversation_id) });
      if (msg.payload.issue_id) {
        qc.invalidateQueries({ queryKey: queryKeys.issues.detail(msg.payload.issue_id) });
      }
      break;
    case "stage_suggestion":
      qc.invalidateQueries({ queryKey: queryKeys.issues.stageSuggestion(msg.payload.issueId) });
      break;
  }
}

function handleAgentEvent(
  event: WsAgentEvent,
  qc: ReturnType<typeof useQueryClient>,
  conversationId: string,
  onPermissionRequired?: (perm: PendingPermission) => void,
) {
  const { event: inner } = event;
  const msgKey = queryKeys.conversations.messages(conversationId);

  switch (inner.type) {
    case "message_started": {
      qc.setQueryData<MessageWithEvents[]>(msgKey, (old) => {
        if (!old) return old;
        if (old.some((m) => m.id === inner.message_id)) return old;
        return [...old, {
          id: inner.message_id, conversation_id: conversationId, client_id: inner.client_id ?? null,
          from_role: inner.role_name, to_roles: [], role: inner.role, quoted_message_id: null,
          context_cutoff_at: "0", runtime: null, status: inner.status,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          events: [], context: null,
        }];
      });
      break;
    }
    case "message_event_appended": {
      qc.setQueryData<MessageWithEvents[]>(msgKey, (old) =>
        old?.map((m) => m.id === inner.message_id ? { ...m, events: [...m.events, inner.event] } : m)
      );
      break;
    }
    case "message_context_updated": {
      qc.setQueryData<MessageWithEvents[]>(msgKey, (old) =>
        old?.map((m) => m.id === inner.message_id ? { ...m, context: inner.context } : m)
      );
      break;
    }
    case "message_status_changed": {
      qc.setQueryData<MessageWithEvents[]>(msgKey, (old) =>
        old?.map((m) => m.id === inner.message_id
          ? { ...m, status: inner.status, ...(inner.context != null ? { context: inner.context } : {}) }
          : m
        )
      );
      break;
    }
    case "permission_required": {
      onPermissionRequired?.({
        messageId: inner.message_id,
        roleName: inner.role_name,
        request: inner.request,
      });
      break;
    }
  }
}
