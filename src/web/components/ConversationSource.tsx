/**
 * ConversationSource - 对话来源显示
 *
 * 显示当前 conversation 的来源 conversation 列表
 */

import { useEffect, useState } from "react";
import { api } from "../services/api-client";
import type { ConversationSource } from "../types";

export function ConversationSource({ conversationId }: { conversationId: string | null }) {
  const [sources, setSources] = useState<ConversationSource[]>([]);

  useEffect(() => {
    if (!conversationId) { setSources([]); return; }
    api("GET /api/conversations/:conversationId", { params: { conversationId } })
      .then((data) => {
        const sourceIds = data.from_conversation_ids || [];
        if (sourceIds.length === 0) { setSources([]); return; }
        // 加载来源 conversation 信息
        Promise.all(sourceIds.map((id: string) =>
          api("GET /api/conversations/:conversationId", { params: { conversationId: id } }).catch(() => null)
        )).then((results) => {
          setSources(results.filter(Boolean).map((c: Record<string, unknown>) => ({
            id: c.id,
            title: c.title || `Conversation #${c.id}`,
          })));
        });
      })
      .catch(() => setSources([]));
  }, [conversationId]);

  if (sources.length === 0) return null;

  return (
    <div className="context-note" style={{ padding: "var(--space-sm) var(--space-md)", fontSize: "var(--font-size-xs)", color: "var(--color-text-grey)" }}>
      <span>来源 conversation</span>
      <p style={{ margin: "4px 0 0" }}>
        {sources.map((s) => s.title).join(", ")}
      </p>
    </div>
  );
}
