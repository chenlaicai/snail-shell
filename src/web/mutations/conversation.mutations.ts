import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";
import type { ConversationKind } from "@/types";

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      content?: string;
      events?: Array<{ kind: "text" | "content_block"; payload: unknown }>;
      from_role?: string; producer_role?: string;
      quoted_message_id?: number; asker_role?: string; client_id?: string;
    }) => api("POST /api/conversations/:conversationId/messages", { params: { conversationId }, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.conversations.messages(conversationId) });
      qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
    },
  });
}

export function useInterruptMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: number) => api("POST /api/conversations/:conversationId/messages/:messageId/interrupt", {
      params: { conversationId, messageId },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.conversations.messages(conversationId) });
    },
  });
}

export function useApproveTool(conversationId: string, messageId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { approved: boolean }) =>
      api("POST /api/conversations/:conversationId/messages/:messageId/approve-tool", {
        params: { conversationId, messageId }, body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.conversations.messages(conversationId) });
    },
  });
}

export function useCreateConversation(issueId: string, stageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      workspace_id: string; title: string; kind: ConversationKind;
      from_conversation_ids?: string[]; summary?: string;
    }) => api("POST /api/issues/:issueId/stages/:stageId/conversations", {
      params: { issueId, stageId }, body,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.issues.conversations(issueId) });
    },
  });
}

export function useAckBossMentions(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("POST /api/conversations/:conversationId/boss-mentions/ack", {
      params: { conversationId },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.conversations.bossMentions(conversationId) });
    },
  });
}
