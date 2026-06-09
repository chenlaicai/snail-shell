import { useEffect, useState } from "react";
import { api } from "../services/api-client";
import type { BossMentionItem } from "../types";

export function BossMentionsBanner({ conversationId }: { conversationId: string | null }) {
  const [mentions, setMentions] = useState<BossMentionItem[]>([]);

  useEffect(() => {
    if (!conversationId) { setMentions([]); return; }
    api("GET /api/conversations/:conversationId/boss-mentions", { params: { conversationId } })
      .then((data) => setMentions(Array.isArray(data) ? data : []))
      .catch(() => setMentions([]));
  }, [conversationId]);

  if (mentions.length === 0) return null;

  return (
    <div className="mx-[var(--space-lg)] my-[var(--space-sm)] p-[var(--space-md)] bg-[rgba(251,191,36,0.08)] border border-[rgba(251,191,36,0.2)] rounded-[var(--radius-md)]">
      <div className="text-[var(--font-size-sm)] font-semibold text-[var(--color-warning-text)] mb-[var(--space-xs)]">Boss Mentions</div>
      <div className="text-[var(--font-size-xs)] text-[var(--color-text-muted)] mb-[var(--space-sm)]">以下 mention 已在本次进入会话时标记为已读，离开会话或刷新页面后列表会消失。</div>
      {mentions.map((m) => (
        <button
          key={m.message_id}
          className="block w-full text-left px-[var(--space-sm)] py-[var(--space-xs)] rounded-[var(--radius-sm)] hover:bg-[rgba(251,191,36,0.08)] mb-[var(--space-xs)]"
          onClick={() => {
            const el = document.getElementById(`msg-${m.message_id}`);
            el?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          <div className="text-[10px] text-[var(--color-text-grey)]">{m.from_role || "unknown"} · {m.created_at || ""}</div>
          <div className="text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">{m.preview || "(空消息)"}</div>
        </button>
      ))}
    </div>
  );
}
