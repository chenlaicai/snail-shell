import type { ConversationHistorySearchResult, ConversationStore, MessageWithEvents } from "../persistence/store";
import type { ConversationHistorySearchPage, ConversationHistoryWindow, ConversationMessagesPage, ConversationRecentMessagesSnapshot } from "./manager-types";

export function getConversationMessages(store: ConversationStore, conversationId: string, limit = 100, offset = 0): MessageWithEvents[] {
  return store.getMessages(conversationId, limit, offset);
}

export function getRecentConversationMessages(store: ConversationStore, conversationId: string, limit: number): ConversationRecentMessagesSnapshot {
  return store.getRecentMessagesSnapshot(conversationId, limit);
}

export function getConversationEventsAfter(store: ConversationStore, conversationId: string, afterEventId: number): ReturnType<ConversationStore["getMessageEventsAfter"]> {
  return store.getMessageEventsAfter(conversationId, afterEventId);
}

export function getLastConversationEventId(store: ConversationStore, conversationId: string): number {
  return store.getLastMessageEventId(conversationId);
}

export function getConversationEventsBetween(store: ConversationStore, conversationId: string, afterEventId: number, untilEventId: number): ReturnType<ConversationStore["getMessageEventsAfter"]> {
  return store.getMessageEventsAfter(conversationId, afterEventId, untilEventId);
}

export function getConversationMessagesByIds(store: ConversationStore, conversationId: string, messageIds: number[]): MessageWithEvents[] {
  return store.getMessagesByIds(conversationId, messageIds);
}

export function getConversationMessageWindow(input: { store: ConversationStore; conversationId: string; anchorMessageId: number; before?: number; after?: number }): ConversationHistoryWindow {
  return { items: input.store.getMessageWindow(input.conversationId, input.anchorMessageId, input.before ?? 2, input.after ?? 2) };
}

export function getConversationMessagesPage(store: ConversationStore, conversationId: string, options: { limit?: number; offset?: number; before?: number } = {}): ConversationMessagesPage {
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  const before = options.before;
  const normalizedLimit = Math.max(1, Math.min(limit, 50));
  if (before !== undefined && before > 0) {
    const items = store.getMessagesBefore(conversationId, before, normalizedLimit);
    return { items, next_offset: 0, has_more: items.length === normalizedLimit };
  }
  const normalizedOffset = Math.max(0, offset);
  const items = store.getMessages(conversationId, normalizedLimit, normalizedOffset);
  return { items, next_offset: normalizedOffset + items.length, has_more: items.length === normalizedLimit };
}

export function searchConversationHistory(input: { store: ConversationStore; conversationId: string; query: string; limit?: number; offset?: number }): ConversationHistorySearchPage {
  const normalizedLimit = Math.max(1, Math.min(input.limit ?? 5, 20));
  const normalizedOffset = Math.max(0, input.offset ?? 0);
  const items: ConversationHistorySearchResult[] = input.store.searchConversationMessages(input.conversationId, input.query, normalizedLimit, normalizedOffset);
  return { items, next_offset: normalizedOffset + items.length, has_more: items.length === normalizedLimit };
}
