import { createMessageStore } from "./message-store.js";
import { isCurrentConversationEvent } from "./realtime-guard.js";

export function createRealtimeManager(input) {
  const stores = new Map();
  const sockets = new Map();

  function getStore(conversationId) {
    let store = stores.get(conversationId);
    if (!store) {
      store = createMessageStore(() => input.onStoreChange(conversationId, store));
      stores.set(conversationId, store);
      store.reset(conversationId);
    }
    return store;
  }

  function connect(conversationId) {
    const existing = sockets.get(conversationId);
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) return existing;
    const ws = new WebSocket(`${input.websocketUrl()}?conversation_id=${conversationId}`);
    sockets.set(conversationId, ws);
    ws.onopen = () => input.onSocketOpen?.(conversationId);
    ws.onmessage = (event) => handleMessage(conversationId, event);
    ws.onclose = () => {
      if (sockets.get(conversationId) === ws) sockets.delete(conversationId);
    };
    return ws;
  }

  function handleMessage(conversationId, event) {
    const message = JSON.parse(event.data);
    if (message.type === "agent_event") {
      if (!isCurrentConversationEvent(message, conversationId, conversationId)) return;
      applyAgentEvent(conversationId, message.event);
      return;
    }
    if (message.type === "error") input.onSocketError(conversationId, message.error, message.client_id || null);
    else if (message.type === "conversation_badge") input.onConversationBadge(message.payload);
  }

  function applyAgentEvent(conversationId, event) {
    const store = getStore(conversationId);
    if (event.type === "message_started") {
      store.applyRealtimeStart(event);
      input.onMessageStarted(conversationId);
    } else if (event.type === "message_event_appended") {
      store.applyRealtimeEvent(event);
    } else if (event.type === "message_status_changed") {
      store.applyRealtimeStatus(event);
      input.onMessageStatusChanged(conversationId);
    }
  }

  function send(conversationId, payload) {
    const ws = connect(conversationId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }

  return { getStore, connect, send };
}
