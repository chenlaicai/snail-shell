import { useEffect, useRef } from "react";
import { useConversationStore } from "../stores/conversationStore";

interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

/** 处理 WebSocket 消息，更新 store */
function handleMessage(msg: WebSocketMessage, updateMessage: (id: number, updates: Record<string, unknown>) => void) {
  if (msg.type === "agent_event") {
    const event = msg.event as { type: string; [key: string]: unknown };
    if (event.type === "event_appended") {
      updateMessage(event.message_id as number, { content: (event.content as string) || "" });
    } else if (event.type === "message_status_changed") {
      updateMessage(event.message_id as number, { status: event.status as string });
    }
  }
}

interface WsHandlers {
  mounted: () => boolean;
  onOpen: () => void;
  onMessage: (msg: WebSocketMessage) => void;
  onClose: () => void;
}

/** 创建 WebSocket 连接并设置事件处理器 */
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

export function useWebSocket(conversationId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);
  const { setWsStatus, updateMessage } = useConversationStore();

  useEffect(() => {
    if (!conversationId) return;
    let mounted = true;

    function connect() {
      if (!mounted) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      setWsStatus("reconnecting");
      wsRef.current = createWsConnection(
        `${proto}//${location.host}/ws?conversation_id=${conversationId}`,
        {
          mounted: () => mounted,
          onOpen: () => { setWsStatus("connected"); reconnectDelay.current = 1000; },
          onMessage: (msg) => handleMessage(msg, updateMessage),
          onClose: () => {
            setWsStatus("disconnected");
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
  }, [conversationId]);

  return wsRef;
}
