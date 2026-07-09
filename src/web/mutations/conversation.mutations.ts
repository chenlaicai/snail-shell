import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";
import { createPlaceholderMessage } from "../hooks/useWebSocket";
import { useConversationStore } from "../stores/conversationStore";
import {
  generateOptimisticId,
  savePendingMessage,
  removePendingMessage,
  markPendingMessageFailed,
} from "../lib/pending-messages";
import type { MessageDto } from "../types";

/**
 * 发送消息 mutation
 *
 * 设计要点（F20260709vx38）：
 * 1. onMutate: 乐观更新 status="sending" + 生成 client_id + 写入 localStorage
 * 2. onSuccess: 删除 localStorage；WS 连接时不 refetch（由 user_called 事件替换乐观消息），
 *    WS 断连时 refetch 作为 fallback
 * 3. onError: 标记 status="failed" + 更新 localStorage + 无条件 refetch
 *    （replaceOptimisticMessage 只匹配 status="sending"，不匹配 "failed"，
 *    若不 refetch，user_called 事件会作为新消息追加导致重复）
 * 4. 不定义 onSettled -- refetch 逻辑已在 onSuccess/onError 中按条件处理
 */
export function useSendMessage(stageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { text: string; from_speaker?: string; to_speakers?: string[] }) =>
      api("POST /api/stages/:stageId/messages", { params: { stageId }, body }),

    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: queryKeys.stages.messages(stageId) });
      const previous = qc.getQueryData<MessageDto[]>(queryKeys.stages.messages(stageId));
      const optimisticId = generateOptimisticId();
      const clientId = `opt-${crypto.randomUUID()}`;

      /** 写入 localStorage，页面刷新时可恢复 */
      savePendingMessage({
        id: optimisticId,
        stageId,
        content: body.text,
        toSpeakers: body.to_speakers,
        createdAt: new Date().toISOString(),
        status: "sending",
        clientId,
      });

      /** 插入缓存，status = "sending"（前端专有状态），client_id 用于稳定虚拟列表 key */
      qc.setQueryData(queryKeys.stages.messages(stageId), (old: MessageDto[] | undefined) => [
        createPlaceholderMessage(stageId, { id: optimisticId, role: "user", status: "sending", content: body.text, client_id: clientId }),
        ...(old ?? []),
      ]);

      return { previous, optimisticId, clientId };
    },

    onSuccess: (_data, _body, context) => {
      /** 发送成功：删除 localStorage 条目。
       *  不在这里更新缓存 status -- 保留 "sending" 让 WebSocket user_called
       *  事件能通过 replaceOptimisticMessage 匹配并替换为服务端真实消息。
       */
      removePendingMessage(stageId, context.optimisticId);
      /** WebSocket 连接正常时，user_called 事件会替换乐观消息，无需 refetch。
       *  WebSocket 断连时，refetch 作为 fallback 确保最终一致。
       */
      if (useConversationStore.getState().wsStatus !== "connected") {
        qc.invalidateQueries({ queryKey: queryKeys.stages.messages(stageId) });
      }
    },

    onError: (_err, _body, context) => {
      /** 发送失败：标记 localStorage 为 "failed" */
      markPendingMessageFailed(stageId, context.optimisticId);
      /** 更新缓存：status "sending" -> "failed"（不回滚，保留消息在界面上） */
      qc.setQueryData(queryKeys.stages.messages(stageId), (old: MessageDto[] | undefined) =>
        old?.map((m) => (m.id === context.optimisticId ? { ...m, status: "failed" } : m)),
      );
      /** 无条件 refetch：POST 失败但服务端可能已创建消息（网络错误场景）。
       *  replaceOptimisticMessage 只匹配 status="sending"，不匹配 "failed"，
       *  如果不 refetch，user_called 事件会作为新消息追加，导致缓存中出现重复消息。
       */
      qc.invalidateQueries({ queryKey: queryKeys.stages.messages(stageId) });
    },
  });
}
