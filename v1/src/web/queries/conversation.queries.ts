import { queryOptions } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "./keys";
import { MessageDtoSchema } from "../../api-contracts/validators";

export const conversationQueries = {
  detail: (conversationId: string) =>
    queryOptions({
      queryKey: queryKeys.conversations.detail(conversationId),
      queryFn: () => api("GET /api/conversations/:conversationId", { params: { conversationId } }),
    }),

  messages: (conversationId: string, query?: { limit?: number; offset?: number }) =>
    queryOptions({
      queryKey: queryKeys.conversations.messages(conversationId),
      queryFn: () => api("GET /api/conversations/:conversationId/messages", { params: { conversationId }, query, schema: MessageDtoSchema.array() }),
      staleTime: 0, // 消息实时性要求高，WebSocket 推送会主动更新缓存
    }),
};
