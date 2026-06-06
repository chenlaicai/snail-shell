import { useEffect, useState } from "react";
import { api } from "../services/api-client";
import type { KnowledgeEntryDto } from "../types";

export function KnowledgeLibrary() {
  const [globalItems, setGlobalItems] = useState<KnowledgeEntryDto[]>([]);
  const [workspaceItems, setWorkspaceItems] = useState<KnowledgeEntryDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api("GET /api/knowledge/items", { query: { scope: "global", limit: 50 } }),
      api("GET /api/knowledge/items", { query: { scope: "workspace", limit: 50 } }),
    ])
      .then(([g, w]) => { setGlobalItems(g); setWorkspaceItems(w); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">加载中...</div>;

  return (
    <div className="flex flex-col h-full min-h-0" data-view-pane="knowledge">
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <div className="flex items-center gap-4 p-3 px-6 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
          <div className="flex items-baseline gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">知识库</span>
            <span className="text-[11px] text-[var(--color-text-grey)]">{globalItems.length + workspaceItems.length} 条</span>
          </div>
        </div>
        <div className="p-6 overflow-auto flex-1">
          <h3 className="text-xs text-[var(--color-text-muted)] mb-3">Global</h3>
          {globalItems.length === 0 ? <div className="empty-state">暂无全局知识</div> : (
            <div className="grid gap-2 mb-6">
              {globalItems.map((item) => <KnowledgeCard key={item.id} item={item} />)}
            </div>
          )}
          <h3 className="text-xs text-[var(--color-text-muted)] mb-3">Workspace</h3>
          {workspaceItems.length === 0 ? <div className="empty-state">暂无工作区知识</div> : (
            <div className="grid gap-2">
              {workspaceItems.map((item) => <KnowledgeCard key={item.id} item={item} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KnowledgeCard({ item }: { item: KnowledgeEntryDto }) {
  return (
    <div className="flex gap-2.5 py-3 px-3.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-muted)] rounded-[var(--radius-sm)] mb-1.5 cursor-pointer transition-all duration-150 relative hover:border-[var(--color-border-default)] hover:bg-[var(--color-bg-active)]">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[13px] font-semibold text-[var(--color-text-primary)] flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{item.title}</span>
          <span className="text-[10px] text-[var(--color-text-grey)] font-mono shrink-0">{item.scope}</span>
        </div>
        <div className="text-xs text-[var(--color-text-muted)] leading-normal mb-2 line-clamp-2">{item.content.slice(0, 100)}</div>
      </div>
    </div>
  );
}
