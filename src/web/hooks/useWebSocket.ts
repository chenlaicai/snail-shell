import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../queries/keys";
import type { MessageWithEvents, WsAgentEvent, WsServerMessage, ToolPermissionRequest } from "../types";

interface PendingPermission {
  messageId: number;
  roleName: string;
  request: ToolPermissionRequest;
}

export type WsStatus = "connected" | "disconnected" | "reconnecting";

const MAX_RETRIES = 20;
const MAX_BACKOFF = 30000;

export function useWebSocket(
  conversationId: string | null,
  onPermissionRequired?: (perm: PendingPermission) => void,
  onStatusChange?: (status: WsStatus) => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const qc = useQueryClient();
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const backoffRef = useRef(1000);
  const retriesRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  // Cache callbacks in refs to avoid reconnect on callback identity change
  const onPermRef = useRef(onPermissionRequired);
  const onStatusRef = useRef(onStatusChange);
  onPermRef.current = onPermissionRequired;
  onStatusRef.current = onStatusChange;

  const connect = useCallback(() => {
    if (!conversationId) return;
    intentionalCloseRef.current = false;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?conversation_id=${conversationId}`);
    wsRef.current = ws;

    ws.onopen = () => { backoffRef.current = 1000; retriesRef.current = 0; onStatusRef.current?.("connected"); };
    ws.onmessage = (e) => { handleWsMessage(e, qc, conversationId, onPermRef.current); };
    ws.onclose = () => {
      if (intentionalCloseRef.current) return;
      onStatusRef.current?.("reconnecting");
      if (retriesRef.current >= MAX_RETRIES) { onStatusRef.current?.("disconnected"); return; }
      retriesRef.current++;
      reconnectRef.current = setTimeout(() => { backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF); connect(); }, backoffRef.current);
    };
    ws.onerror = (e) => { console.error("[WS] Connection error:", e); ws.close(); };
  }, [conversationId, qc]);

  useEffect(() => {
    connect();
    return () => { intentionalCloseRef.current = true; clearTimeout(reconnectRef.current); wsRef.current?.close(); };
  }, [connect]);

  const send = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) { wsRef.current.send(JSON.stringify(data)); return true; }
    return false;
  }, []);

  const reconnect = useCallback(() => {
    retriesRef.current = 0;
    backoffRef.current = 1000;
    wsRef.current?.close();
    connect();
  }, [connect]);

  return { wsRef, send, reconnect };
}

function handleWsMessage(e: MessageEvent, qc: ReturnType<typeof useQueryClient>, conversationId: string, onPermissionRequired?: (perm: PendingPermission) => void) {
  try {
    const msg: WsServerMessage = JSON.parse(e.data);
    handleMessage(msg, qc, conversationId, onPermissionRequired);
  } catch (err) { console.error("[WS] Failed to parse message:", err); }
}

function handleMessage(msg: WsServerMessage, qc: ReturnType<typeof useQueryClient>, conversationId: string, onPermissionRequired?: (perm: PendingPermission) => void) {
  if (msg.type === "agent_event") { handleAgentEvent(msg, qc, conversationId, onPermissionRequired); return; }
  if (msg.type === "error") { console.error("[WS Error]", msg.error, msg.hint); return; }
  if (msg.type === "conversation_badge") {
    qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(msg.payload.conversation_id) });
    if (msg.payload.issue_id) qc.invalidateQueries({ queryKey: queryKeys.issues.detail(msg.payload.issue_id) });
    return;
  }
  if (msg.type === "stage_suggestion") { qc.invalidateQueries({ queryKey: queryKeys.issues.stageSuggestion(msg.payload.issueId) }); }
}

function handleAgentEvent(event: WsAgentEvent, qc: ReturnType<typeof useQueryClient>, conversationId: string, onPermissionRequired?: (perm: PendingPermission) => void) {
  const { event: inner } = event;
  const msgKey = queryKeys.conversations.messages(conversationId);
  if (inner.type === "message_started") { appendPlaceholderMessage(qc, msgKey, inner, conversationId); return; }
  if (inner.type === "message_event_appended") { qc.setQueryData<MessageWithEvents[]>(msgKey, (old) => old?.map((m) => m.id === inner.message_id ? { ...m, events: [...m.events, inner.event] } : m)); return; }
  if (inner.type === "message_context_updated") { qc.setQueryData<MessageWithEvents[]>(msgKey, (old) => old?.map((m) => m.id === inner.message_id ? { ...m, context: inner.context } : m)); return; }
  if (inner.type === "message_status_changed") { qc.setQueryData<MessageWithEvents[]>(msgKey, (old) => old?.map((m) => m.id === inner.message_id ? { ...m, status: inner.status, ...(inner.context != null ? { context: inner.context } : {}) } : m)); return; }
  if (inner.type === "permission_required") { onPermissionRequired?.({ messageId: inner.message_id, roleName: inner.role_name, request: inner.request }); }
}

function appendPlaceholderMessage(qc: ReturnType<typeof useQueryClient>, msgKey: readonly unknown[], inner: { message_id: number; client_id?: string; role_name: string; role: string; status: string; created_at: string }, conversationId: string) {
  qc.setQueryData<MessageWithEvents[]>(msgKey, (old) => {
    if (!old) return old;
    if (old.some((m) => m.id === inner.message_id)) return old;
    return [...old, { id: inner.message_id, conversation_id: conversationId, client_id: inner.client_id ?? null, from_role: inner.role_name, to_roles: [], role: inner.role as MessageWithEvents["role"], quoted_message_id: null, context_cutoff_at: "0", runtime: null, status: inner.status as MessageWithEvents["status"], created_at: inner.created_at, updated_at: inner.created_at, events: [], context: null }];
  });
}
