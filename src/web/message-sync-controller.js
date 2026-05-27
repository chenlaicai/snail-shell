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
    const store = input.getMessageStore(conversationId);
    store.replaceHistory(conversationId, messages);
    store.setHasMore(messages.length >= 20);
    if (Number.isInteger(snapshot?.last_event_id)) updateCursor(conversationId, snapshot.last_event_id);
    input.syncSendAvailability(conversationId);
    await input.loadDispatchState(conversationId, selectionToken);
    return true;
  }

  /**
   * Load older messages from the server using cursor-based pagination.
   *
   * Uses the earliest persisted message ID in the store as the `before` cursor
   * to fetch the page directly preceding the current visible window. This ensures
   * continuous reverse-chronological reading without gaps, regardless of total
   * message count.
   * When the server reports no more pages or no new messages were added,
   * hasMore is set to false to stop further scroll-triggered requests.
   */
  async function loadOlderMessages(conversationId) {
    const store = input.getMessageStore(conversationId);
    const state = store.getState();
    let earliestId = null;
    for (const r of state.records) {
      if (Number.isInteger(r.id) && (earliestId === null || r.id < earliestId)) {
        earliestId = r.id;
      }
    }
    let page;
    if (earliestId !== null) {
      page = await input.api("GET", `/conversations/${conversationId}/messages/page?limit=20&before=${earliestId}`);
    } else {
      page = await input.api("GET", `/conversations/${conversationId}/messages/page?limit=20&offset=0`);
    }
    const items = Array.isArray(page?.items) ? page.items : [];
    const hasMore = Boolean(page?.has_more);
    const added = store.prependHistory(conversationId, items);
    if (!hasMore || added === 0) store.setHasMore(false);
    return added;
  }

  return { clearReconnectTimer, connect, loadMessages, loadOlderMessages, scheduleReconnect, updateCursor };
}
