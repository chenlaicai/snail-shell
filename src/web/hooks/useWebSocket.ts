import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConversationStore } from "../stores/conversationStore";
import { queryKeys } from "../queries/keys";
import type { MessageDto, WsServerMessage } from "../types";

/** 创建占位 MessageDto——用于 WebSocket message_started 和乐观发送 */
export function createPlaceholderMessage(
  stageId: string,
  opts: { id: number; role: MessageDto["role"]; from_role?: string | null; client_id?: string | null; status?: MessageDto["status"]; content?: string }
): MessageDto {
  return {
    id: opts.id,
    stage_id: stageId,
    conversation_id: stageId,
    client_id: opts.client_id ?? null,
    from_speaker: opts.from_role ?? null,
    from_role: opts.from_role ?? null,
    to_speakers: [],
    to_roles: [],
    role: opts.role,
    quoted_message_id: null,
    context_cutoff_at: "",
    runtime: null,
    status: opts.status ?? "streaming",
    created_at: new Date().toISOString(),
    ended_at: null,
    updated_at: new Date().toISOString(),
    content: opts.content,
    context: null,
    events: [],
    quoted_message: null,
  };
}

function addPlaceholderMessage(
  queryClient: ReturnType<typeof useQueryClient>,
  stageId: string,
  opts: { id: number; role: MessageDto["role"]; from_role?: string | null; client_id?: string | null; status?: MessageDto["status"] },
): void {
  queryClient.setQueryData(
    queryKeys.stages.messages(stageId),
    (old: MessageDto[] | undefined) => {
      if (old?.some((m) => m.id === opts.id)) return old;
      return [...(old ?? []), createPlaceholderMessage(stageId, opts)];
    },
  );
}

function handleRealtimeMessage(
  msg: WsServerMessage,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  if (msg.type === "heartbeat") return;
  const { event } = msg;
  const stageId = event.stage_id;

  if (event.type === "message_started") {
    addPlaceholderMessage(queryClient, stageId, {
      id: event.message_id,
      role: event.role,
      from_role: event.role_name,
      client_id: event.client_id,
      status: event.status,
    });
    return;
  }

  if (event.type === "message_event_appended") {
    queryClient.setQueryData(
      queryKeys.stages.messages(stageId),
      (old: MessageDto[] | undefined) => old?.map((m) =>
        m.id === event.message_id
          ? { ...m, events: [...(m.events ?? []), event.event] }
          : m
      ),
    );
    return;
  }

  if (event.type === "message_status_changed") {
    queryClient.setQueryData(
      queryKeys.stages.messages(stageId),
      (old: MessageDto[] | undefined) => old?.map((m) =>
        m.id === event.message_id ? { ...m, status: event.status, context: event.context ?? m.context, updated_at: new Date().toISOString() } : m
      ),
    );
    return;
  }

  if (event.type === "user_called") {
    addPlaceholderMessage(queryClient, stageId, {
      id: event.message_id,
      role: event.role,
      from_role: event.role_name,
      client_id: event.client_id,
      status: event.status,
    });
    return;
  }

  if (event.type === "stage_transition_suggested") {
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(msg.issue_id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.stages.detail(stageId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.stages.messages(stageId) });
  }
}

interface WsHandlers {
  mounted: () => boolean;
  onOpen: () => void;
  onMessage: (msg: WsServerMessage) => void;
  onClose: () => void;
}

function createWsConnection(url: string, handlers: WsHandlers): WebSocket {
  const ws = new WebSocket(url);
  ws.onopen = () => { if (handlers.mounted()) handlers.onOpen(); };
  ws.onmessage = (e) => {
    if (!handlers.mounted()) return;
    try { handlers.onMessage(JSON.parse(e.data)); }
    catch (err) { console.warn("[WebSocket] 消息解析失败:", err, e.data); }
  };
  ws.onclose = () => { if (handlers.mounted()) handlers.onClose(); };
  ws.onerror = () => ws.close();
  return ws;
}

function clearTimer(timer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>): void {
  if (timer.current) {
    clearTimeout(timer.current);
    timer.current = null;
  }
}

export function useIssueRealtime(issueId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);
  const queryClient = useQueryClient();
  const { setWsStatus, currentStage } = useConversationStore();
  const currentStageIdRef = useRef<string | null>(null);
  currentStageIdRef.current = currentStage?.id ?? null;

  useEffect(() => {
    if (!issueId) {
      setWsStatus("disconnected");
      return;
    }
    let mounted = true;
    let activeWs: WebSocket | null = null;

    function connect() {
      if (!mounted) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      setWsStatus("reconnecting");
      const ws = createWsConnection(
        `${proto}//${location.host}/issue-events?issue_id=${encodeURIComponent(issueId)}`,
        {
          mounted: () => mounted && activeWs === ws && wsRef.current === ws,
          onOpen: () => {
            clearTimer(reconnectTimer);
            queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
            const currentStageId = currentStageIdRef.current;
            if (currentStageId) queryClient.invalidateQueries({ queryKey: queryKeys.stages.messages(currentStageId) });
            setWsStatus("connected");
            reconnectDelay.current = 1000;
          },
          onMessage: (msg) => handleRealtimeMessage(msg, queryClient),
          onClose: () => {
            if (!mounted || activeWs !== ws || wsRef.current !== ws) return;
            setWsStatus("disconnected");
            console.log(`[WebSocket] 连接关闭，${reconnectDelay.current}ms 后重连`);
            reconnectTimer.current = setTimeout(() => {
              reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
              connect();
            }, reconnectDelay.current);
          },
        },
      );
      activeWs = ws;
      wsRef.current = ws;
    }

    connect();
    return () => {
      mounted = false;
      clearTimer(reconnectTimer);
      if (activeWs) {
        const ws = activeWs;
        activeWs = null;
        if (wsRef.current === ws) wsRef.current = null;
        ws.close();
      }
    };
  }, [issueId, queryClient, setWsStatus]);

  return wsRef;
}
