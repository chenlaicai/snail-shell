export function createMessageSyncController(input) {
  const cursors = new Map();
  const reconnectTimers = new Map();

  function updateCursor(conversationId, eventId) {
    const current = cursors.get(conversationId) || 0;
    if (Number.isInteger(eventId) && eventId > current) cursors.set(conversationId, eventId);
  }

  function clearReconnectTimer(conversationId) {
    const timer = reconnectTimers.get(conversationId);
    if (!timer) return;
    clearTimeout(timer);
    reconnectTimers.delete(conversationId);
  }

  function connect(conversationId) {
    return input.realtime.connect(conversationId, { afterEventId: cursors.get(conversationId) || 0 });
  }

  function scheduleReconnect(conversationId) {
    if (!input.isActiveConversation(conversationId) || reconnectTimers.has(conversationId)) return;
    const timer = setTimeout(() => {
      reconnectTimers.delete(conversationId);
      if (input.isActiveConversation(conversationId)) connect(conversationId);
    }, 1000);
    reconnectTimers.set(conversationId, timer);
  }

  async function loadMessages(conversationId, selectionToken) {
    const snapshot = await input.api("GET", `/conversations/${conversationId}/messages/recent?limit=20`);
    const messages = Array.isArray(snapshot) ? snapshot : snapshot.items;
    if (!input.isCurrentSelection(conversationId, selectionToken)) return false;
    input.getMessageStore(conversationId).replaceHistory(conversationId, messages);
    if (Number.isInteger(snapshot?.last_event_id)) updateCursor(conversationId, snapshot.last_event_id);
    input.syncSendAvailability(conversationId);
    await input.loadDispatchState(conversationId, selectionToken);
    return true;
  }

  return { clearReconnectTimer, connect, loadDispatchState: input.loadDispatchState, loadMessages, scheduleReconnect, updateCursor };
}
