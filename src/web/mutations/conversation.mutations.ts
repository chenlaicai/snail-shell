import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";
import { createPlaceholderMessage } from "../hooks/useWebSocket";
import type { MessageDto } from "../types";

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { content?: string; events?: Array<{ kind: "text" | "content_block"; payload: unknown }>; from_role?: string; quoted_message_id?: number; client_id?: string }) =>
      api("POST /api/conversations/:conversationId/messages", { params: { conversationId }, body }),

    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: queryKeys.conversations.messages(conversationId) });
      const previous = qc.getQueryData<MessageDto[]>(queryKeys.conversations.messages(conversationId));
      const optimisticId = Date.now();
      qc.setQueryData(queryKeys.conversations.messages(conversationId), (old: MessageDto[] | undefined) => [
        ...(old ?? []),
        createPlaceholderMessage(conversationId, { id: optimisticId, role: "user", content: body.content }),
      ]);
      return { previous, optimisticId };
    },

    onError: (_err, _body, context) => {
      if (context?.previous) {
        qc.setQueryData(queryKeys.conversations.messages(conversationId), context.previous);
      }
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.conversations.messages(conversationId) });
    },
  });
}

export function useCreateConversation(issueId: string, stageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { workspace_id: string; title: string; kind: string }) =>
      api("POST /api/issues/:issueId/stages/:stageId/conversations", { params: { issueId, stageId }, body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.issues.conversations(issueId) }); },
  });
}
