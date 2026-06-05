import { useEffect, useState } from "react";
import { api } from "../services/api";
import type { BossMentionItem } from "../types";

export function BossMentionsBanner({ conversationId }: { conversationId: string | null }) {
  const [mentions, setMentions] = useState<BossMentionItem[]>([]);

  useEffect(() => {
    if (!conversationId) { setMentions([]); return; }
    api("GET", `/conversations/${conversationId}/boss-mentions`)
      .then((data) => setMentions(Array.isArray(data) ? data : []))
      .catch(() => setMentions([]));
  }, [conversationId]);

  if (mentions.length === 0) return null;

  return (
    <div className="boss-mentions-banner visible">
      <div className="name">Boss Mentions</div>
      <div className="meta">以下 mention 已在本次进入会话时标记为已读，离开会话或刷新页面后列表会消失。</div>
      {mentions.map((m) => (
        <button
          key={m.message_id}
          className="boss-mention-item"
          onClick={() => {
            const el = document.getElementById(`msg-${m.message_id}`);
            el?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          <div className="meta">{m.from_role || "unknown"} · {m.created_at || ""}</div>
          <div>{m.preview || "(空消息)"}</div>
        </button>
      ))}
    </div>
  );
}
