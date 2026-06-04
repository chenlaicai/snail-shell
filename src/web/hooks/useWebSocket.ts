import { useEffect, useRef } from "react";
import { useConversationStore } from "../stores/conversationStore";

interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

export function useWebSocket(conversationId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);
  const { setWsStatus, appendMessage, updateMessage } = useConversationStore();

  useEffect(() => {
    if (!conversationId) return;

    let mounted = true;

    function connect() {
      if (!mounted) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/ws?conversation_id=${conversationId}`);
      wsRef.current = ws;
      setWsStatus("reconnecting");

      ws.onopen = () => {
        if (!mounted) return;
        setWsStatus("connected");
        reconnectDelay.current = 1000;
      };

      ws.onmessage = (e) => {
        if (!mounted) return;
        try {
          const msg: WebSocketMessage = JSON.parse(e.data);
          handleMessage(msg);
        } catch (err) {
          console.warn("[WebSocket] 消息解析失败:", err, e.data);
        }
      };

      ws.onclose = () => {
        if (!mounted) return;
        setWsStatus("disconnected");
        // Reconnect with exponential backoff
        reconnectTimer.current = setTimeout(() => {
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
          connect();
        }, reconnectDelay.current);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    function handleMessage(msg: WebSocketMessage) {
      if (msg.type === "agent_event") {
        const event = msg.event as { type: string; [key: string]: unknown };
        switch (event.type) {
          case "message_started":
            // API 发送消息时已创建 AI 占位符，无需处理
            break;
          case "event_appended":
            // 更新已有 AI 消息的内容（流式追加）
            updateMessage(event.message_id as number, {
              content: (event.content as string) || "",
            });
            break;
          case "message_status_changed":
            // 更新 AI 消息状态（streaming → completed）
            updateMessage(event.message_id as number, {
              status: event.status as string,
            });
            break;
        }
      }
      if (msg.type === "conversation_badge") {
        // Badge update - could be used for UI indicators
      }
      if (msg.type === "stage_suggestion") {
        // Stage suggestion - could show a banner
      }
    }

    connect();

    return () => {
      mounted = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [conversationId]); // setWsStatus/appendMessage/updateMessage are stable Zustand references

  return wsRef;
}
