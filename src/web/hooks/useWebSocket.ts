import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConversationStore } from "../stores/conversationStore";
import { queryKeys } from "../queries/keys";
import type { WsServerMessage, MessageDto } from "../types";

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

/** 处理 WebSocket 消息，更新 TanStack Query 缓存 */
function handleMessage(
  msg: WsServerMessage,
  stageId: string,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  if (msg.type !== "agent_event") return;
  const { event } = msg;

  if (event.type === "message_started") {
    queryClient.setQueryData(
      queryKeys.stages.messages(stageId),
      (old: MessageDto[] | undefined) => {
        // 去重：相同 message_id 已存在则跳过
        if (old?.some((m) => m.id === event.message_id)) return old;
        return [...(old ?? []), createPlaceholderMessage(stageId, {
          id: event.message_id,
          role: event.role,
          from_role: event.role_name,
          client_id: event.client_id,
          status: event.status,
        })];
      },
    );
  } else if (event.type === "message_event_appended") {
    queryClient.setQueryData(
      queryKeys.stages.messages(stageId),
      (old: MessageDto[] | undefined) => old?.map((m) =>
        m.id === event.message_id
          ? { ...m, events: [...(m.events ?? []), event.event] }
          : m
      ),
    );
  } else if (event.type === "message_status_changed") {
    queryClient.setQueryData(
      queryKeys.stages.messages(stageId),
      (old: MessageDto[] | undefined) => old?.map((m) =>
        m.id === event.message_id ? { ...m, status: event.status } : m
      ),
    );
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

export function useWebSocket(stageId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);
  const queryClient = useQueryClient();
  const { setWsStatus } = useConversationStore();

  useEffect(() => {
    if (!stageId) return;
    let mounted = true;

    function connect() {
      if (!mounted) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      setWsStatus("reconnecting");
      wsRef.current = createWsConnection(
        `${proto}//${location.host}/ws?stage_id=${stageId}`,
        {
          mounted: () => mounted,
          onOpen: () => { setWsStatus("connected"); reconnectDelay.current = 1000; },
          onMessage: (msg) => handleMessage(msg, stageId, queryClient),
          onClose: () => {
            setWsStatus("disconnected");
            console.log(`[WebSocket] 连接关闭，${reconnectDelay.current}ms 后重连`);
            reconnectTimer.current = setTimeout(() => {
              reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
              connect();
            }, reconnectDelay.current);
          },
        },
      );
    }

    connect();
    return () => {
      mounted = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [stageId]);

  return wsRef;
}
