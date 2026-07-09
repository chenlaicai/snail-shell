import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api-client";
import { queryKeys } from "@/queries/keys";
import { createPlaceholderMessage } from "@/hooks/useWebSocket";
import { getPendingMessages, clearPendingMessages } from "@/lib/pending-messages";
import type { MessageDto } from "@/types";

interface UseMessagesOptions {
  stageId: string | null;
}

/**
 * 消息管理 hook：消息查询（含 pending message merge）、历史加载、排序去重。
 * stage 切换时仅负责数据清理，不碰滚动 refs。
 */
export function useMessages({ stageId }: UseMessagesOptions) {
  const { data: messagesQuery } = useQuery({
    queryKey: queryKeys.stages.messages(stageId ?? ""),
    queryFn: () => api("GET /api/stages/:stageId/messages", { params: { stageId: stageId! } }) as Promise<MessageDto[]>,
    enabled: !!stageId,
    /** 页面加载时恢复 pending 消息，去重后按 createdAt 降序合并 */
    select: (serverData) => {
      if (!stageId) return serverData;
      const pending = getPendingMessages(stageId);
      if (pending.length === 0) return serverData;

      /** 去重：如果 pending 消息的 content 与 server 消息匹配，说明 POST 实际成功了 */
      const serverContents = new Set(serverData.map((m) => m.content?.trim()));
      const uniquePending = pending
        .filter((p) => !serverContents.has(p.content?.trim()))
        .map((p) =>
          createPlaceholderMessage(stageId, {
            id: p.id,
            role: "user",
            status: p.status, // "sending" or "failed"
            content: p.content,
            client_id: p.clientId,
            createdAt: p.createdAt,
          }),
        )
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      /** 按 created_at 降序合并（serverData 已是降序） */
      const merged: MessageDto[] = [];
      let pi = 0;
      let si = 0;
      while (pi < uniquePending.length && si < serverData.length) {
        if (new Date(uniquePending[pi].created_at).getTime() >= new Date(serverData[si].created_at).getTime()) {
          merged.push(uniquePending[pi++]);
        } else {
          merged.push(serverData[si++]);
        }
      }
      while (pi < uniquePending.length) merged.push(uniquePending[pi++]);
      while (si < serverData.length) merged.push(serverData[si++]);
      return merged;
    },
  });

  const messages = messagesQuery ?? [];

  // 上拉加载更早的历史消息
  const [olderHistory, setOlderHistory] = useState<MessageDto[]>([]);
  const isLoadingHistoryRef = useRef(false);
  const allHistoryLoadedRef = useRef(false);
  const prevStageIdRef = useRef<string | null>(null);

  /** 当 stageId 切换时，清空旧 stage 的 pending 消息和已加载的历史 */
  useEffect(() => {
    if (prevStageIdRef.current !== stageId) {
      if (prevStageIdRef.current) clearPendingMessages(prevStageIdRef.current);
      prevStageIdRef.current = stageId;
      setOlderHistory([]);
      allHistoryLoadedRef.current = false;
    }
  }, [stageId]);

  // 后端返回 DESC（最新在前），前端反转为正序（最早在前）显示
  const sorted = useMemo(() => {
    const latestAsc = [...messages].reverse();
    if (olderHistory.length === 0) return latestAsc;
    // 去重：olderHistory 中可能包含与 latestAsc 重叠的消息
    const latestIds = new Set(latestAsc.map(m => m.id));
    const uniqueOlder = olderHistory.filter(m => !latestIds.has(m.id));
    return [...uniqueOlder, ...latestAsc];
  }, [messages, olderHistory]);

  return { sorted, olderHistory, setOlderHistory, isLoadingHistoryRef, allHistoryLoadedRef, messagesQuery };
}
