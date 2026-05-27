export function createMessageSyncController(input) {
  const cursors = new Map();
  const reconnectTimers = new Map();
  const loadMoreOffsets = new Map();

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
    const store = input.getMessageStore(conversationId);
    store.replaceHistory(conversationId, messages);
    loadMoreOffsets.set(conversationId, 0);
    store.setHasMore(messages.length >= 20);
    if (Number.isInteger(snapshot?.last_event_id)) updateCursor(conversationId, snapshot.last_event_id);
    input.syncSendAvailability(conversationId);
    await input.loadDispatchState(conversationId, selectionToken);
    return true;
  }

  /**
   * Load older messages from the server using offset-based pagination.
   *
   * Offset starts at 0 (earliest messages) and advances by full page size
   * each call. prependHistory deduplicates against the already-loaded latest
   * messages, so overlapping pages are handled correctly.
   * When the server reports no more pages or no new messages were added,
   * hasMore is set to false to stop further scroll-triggered requests.
   */
  async function loadOlderMessages(conversationId) {
    const offset = loadMoreOffsets.get(conversationId) || 0;
    const page = await input.api("GET", `/conversations/${conversationId}/messages/page?limit=20&offset=${offset}`);
    const items = Array.isArray(page?.items) ? page.items : [];
    const hasMore = Boolean(page?.has_more);
    const store = input.getMessageStore(conversationId);
    const added = store.prependHistory(conversationId, items);
    loadMoreOffsets.set(conversationId, offset + items.length);
    if (!hasMore || added === 0) store.setHasMore(false);
    return added;
  }

  return { clearReconnectTimer, connect, loadMessages, loadOlderMessages, scheduleReconnect, updateCursor };
}
