import { queryOptions } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const conversationQueries = {
  listByIssue: (issueId: string) =>
    queryOptions({
      queryKey: queryKeys.conversations.all,
      queryFn: () => api("GET /api/issues/:issueId/conversations", { params: { issueId } }),
    }),

  detail: (conversationId: string) =>
    queryOptions({
      queryKey: queryKeys.conversations.detail(conversationId),
      queryFn: () => api("GET /api/conversations/:conversationId", { params: { conversationId } }),
    }),

  messages: (conversationId: string) =>
    queryOptions({
      queryKey: queryKeys.conversations.messages(conversationId),
      queryFn: () => api("GET /api/conversations/:conversationId/messages", { params: { conversationId } }),
    }),

  events: (messageId: number) =>
    queryOptions({
      queryKey: queryKeys.conversations.events(messageId),
      queryFn: () => api("GET /api/messages/:messageId/events", { params: { messageId: String(messageId) } }),
    }),
};
