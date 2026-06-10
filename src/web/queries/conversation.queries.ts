import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const conversationQueries = {
  detail: (id: string) => ({
    queryKey: queryKeys.conversations.detail(id),
    queryFn: () => api("GET /api/conversations/:conversationId", { params: { conversationId: id } }),
  }),
  messages: (id: string) => ({
    queryKey: queryKeys.conversations.messages(id),
    queryFn: () => api("GET /api/conversations/:conversationId/messages", { params: { conversationId: id } }),
  }),
  messagesPage: (id: string, offset: number, limit = 50) => ({
    queryKey: queryKeys.conversations.messagesPage(id, offset),
    queryFn: () => api("GET /api/conversations/:conversationId/messages/page", {
      params: { conversationId: id },
      query: { offset, limit },
    }),
  }),
  recentMessages: (id: string, limit = 30) => ({
    queryKey: queryKeys.conversations.recentMessages(id),
    queryFn: () => api("GET /api/conversations/:conversationId/messages/recent", {
      params: { conversationId: id },
      query: { limit },
    }),
  }),
  events: (id: string, afterEventId?: number) => ({
    queryKey: queryKeys.conversations.events(id),
    queryFn: () => api("GET /api/conversations/:conversationId/events", {
      params: { conversationId: id },
      query: afterEventId != null ? { after_event_id: afterEventId } : undefined,
    }),
  }),
  dispatchState: (id: string) => ({
    queryKey: queryKeys.conversations.dispatchState(id),
    queryFn: () => api("GET /api/conversations/:conversationId/dispatch-state", { params: { conversationId: id } }),
  }),
  bossMentions: (id: string) => ({
    queryKey: queryKeys.conversations.bossMentions(id),
    queryFn: () => api("GET /api/conversations/:conversationId/boss-mentions", { params: { conversationId: id } }),
  }),
  historySearch: (id: string, q: string) => ({
    queryKey: queryKeys.conversations.historySearch(id, q),
    queryFn: () => api("GET /api/conversations/:conversationId/history/search", {
      params: { conversationId: id },
      query: { query: q },
    }),
    enabled: q.length > 0,
  }),
  messagesWindow: (id: string, anchorMessageId: number, before = 20, after = 20) => ({
    queryKey: [...queryKeys.conversations.messages(id), "window", anchorMessageId] as const,
    queryFn: () => api("GET /api/conversations/:conversationId/messages/window", {
      params: { conversationId: id },
      query: { anchor_message_id: anchorMessageId, before, after },
    }),
  }),
  messagesByIds: (id: string, messageIds: number[]) => ({
    queryKey: [...queryKeys.conversations.messages(id), "by-ids", messageIds] as const,
    queryFn: () => api("POST /api/conversations/:conversationId/messages/by-ids", {
      params: { conversationId: id },
      body: { message_ids: messageIds },
    }),
  }),
};
