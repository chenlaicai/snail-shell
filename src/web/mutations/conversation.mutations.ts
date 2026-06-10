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
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: queryKeys.conversations.messages(conversationId) });
      const prev = qc.getQueryData(queryKeys.conversations.messages(conversationId));
      const clientId = body.client_id ?? `opt-${Date.now()}`;
      const optimisticMsg = {
        id: Date.now(), conversation_id: conversationId, client_id: clientId,
        from_role: body.from_role ?? null, to_roles: [], role: "user" as const,
        quoted_message_id: body.quoted_message_id ?? null, context_cutoff_at: "0",
        runtime: "system" as const, status: "completed" as const,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        events: body.content ? [{ id: Date.now(), message_id: 0, seq: 1, category: "content" as const, kind: "text" as const,
          payload: { text: body.content, mentions: [] },
          source: { runtime_name: "system" as const, runtime_event_type: null, runtime_message_id: null, runtime_item_id: null, runtime_call_id: null, raw_event: null, metadata: null },
          created_at: new Date().toISOString(),
        }] : [],
        context: null,
      };
      qc.setQueryData(queryKeys.conversations.messages(conversationId), (old: unknown) => {
        const page = old as { items?: unknown[] } | undefined;
        if (!page?.items) return old;
        return { ...page, items: [...page.items, optimisticMsg] };
      });
      return { prev };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.conversations.messages(conversationId), ctx.prev);
    },
    onSettled: () => {
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
