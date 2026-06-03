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

  function connect(conversationId, options = {}) {
    const existing = sockets.get(conversationId);
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) return existing;
    const afterEventId = Number(options.afterEventId) || 0;
    const ws = new WebSocket(`${input.websocketUrl()}?conversation_id=${encodeURIComponent(conversationId)}&after_event_id=${encodeURIComponent(String(afterEventId))}`);
    sockets.set(conversationId, ws);
    ws.onopen = () => input.onSocketOpen?.(conversationId);
    ws.onmessage = (event) => handleMessage(conversationId, event);
    ws.onerror = () => input.onSocketError?.(conversationId, "WebSocket connection error", null);
    ws.onclose = () => {
      if (sockets.get(conversationId) === ws) {
        sockets.delete(conversationId);
        input.onSocketClose?.(conversationId);
      }
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
    else if (message.type === "stage_suggestion") input.onStageSuggestion?.(message.payload);
  }

  function applyAgentEvent(conversationId, event) {
    const store = getStore(conversationId);
    if (event.type === "message_started") {
      store.applyRealtimeStart(event);
      input.onMessageStarted(conversationId);
    } else if (event.type === "message_event_appended") {
      store.applyRealtimeEvent(event);
      if (Number.isInteger(event.event?.id)) input.onMessageEventAppended?.(conversationId, event.event.id);
    } else if (event.type === "message_context_updated") {
      store.applyRealtimeContext(event.message_id, event.context);
    } else if (event.type === "message_status_changed") {
      store.applyRealtimeStatus(event);
      input.onMessageStatusChanged(conversationId);
    } else if (event.type === "permission_required") {
      store.applyPermissionRequired(event);
      input.onStoreChange(conversationId, store);
    }
  }

  function send(conversationId, payload) {
    const ws = connect(conversationId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }

  function disconnect(conversationId) {
    const ws = sockets.get(conversationId);
    if (ws) {
      sockets.delete(conversationId);
      ws.close();
    }
  }

  return { getStore, connect, send, disconnect };
}
