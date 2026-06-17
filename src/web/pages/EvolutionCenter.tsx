import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api-client";
import { evolutionQueries } from "@/queries/evolution.queries";
import { showToast } from "@/components/Toast";
import { Badge } from "@/components/ui/badge";
import { TopBar } from "@/components/TopBar";
import type { EvolutionItemDto } from "@/types";

export function EvolutionCenter() {
  const { data: items = [], isLoading } = useQuery(evolutionQueries.list({ limit: 100 }));
  const [selectedItem, setSelectedItem] = useState<EvolutionItemDto | null>(null);

  async function selectItem(itemId: string) {
    try {
      setSelectedItem(await api("GET /api/evolution/items/:itemId", { params: { itemId } }));
    } catch (err: unknown) {
      showToast(`加载详情失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  if (isLoading) return <div className="flex h-full items-center justify-center text-[13px] text-text-muted">加载中...</div>;

  return (
    <>
      <TopBar breadcrumbs={[{ label: "Evolution Center" }]} />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-[300px] shrink-0 overflow-y-auto border-r border-white/6 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted uppercase tracking-wider">Evolution</span>
            <span className="text-[11px] text-text-muted">{items.length}</span>
          </div>
          {items.length === 0 ? (
            <div className="py-4 text-[13px] text-text-muted">暂无演进项</div>
          ) : items.map((item) => (
            <button
              key={item.id}
              onClick={() => selectItem(item.id)}
              className={`mb-1 w-full rounded-lg p-3 text-left transition-colors ${selectedItem?.id === item.id ? "bg-white/8 text-text-primary" : "text-text-secondary hover:bg-white/5"}`}
            >
              <div className="text-[13px] font-medium">{item.title}</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {item.tags?.slice(0, 2).map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
              </div>
            </button>
          ))}
        </aside>

        <main className="flex-1 overflow-y-auto p-6">
          {selectedItem ? (
            <div className="max-w-3xl">
              <div className="mb-6">
                <h1 className="text-xl font-semibold text-text-primary">{selectedItem.title}</h1>
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedItem.tags?.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
                </div>
                <div className="mt-2 text-[11px] text-text-muted">创建于 {new Date(selectedItem.created_at).toLocaleString()}</div>
              </div>
              {selectedItem.content && <div className="rounded-lg border border-white/6 bg-surface-1 p-4 whitespace-pre-wrap text-[13px] leading-6 text-text-secondary">{selectedItem.content}</div>}
            </div>
          ) : (
            <div className="py-4 text-[13px] text-text-muted">选择一个演进项查看详情</div>
          )}
        </main>
      </div>
    </>
  );
}
