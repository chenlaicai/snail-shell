import { useQuery } from "@tanstack/react-query";
import { knowledgeQueries } from "@/queries/knowledge.queries";
import { TopBar } from "@/components/TopBar";
import type { KnowledgeEntryDto } from "@/types";

export function KnowledgeLibrary() {
  const { data: globalItems = [], isLoading: loadingGlobal } = useQuery(knowledgeQueries.list({ scope: "global", limit: 50 }));
  const { data: workspaceItems = [], isLoading: loadingWorkspace } = useQuery(knowledgeQueries.list({ scope: "workspace", limit: 50 }));
  const loading = loadingGlobal || loadingWorkspace;

  if (loading) return <div className="flex h-full items-center justify-center text-[13px] text-text-muted">加载中...</div>;

  return (
    <>
      <TopBar breadcrumbs={[{ label: "Knowledge Library" }]} />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-text-primary">Knowledge Library</h1>
          <p className="mt-1 text-[13px] text-text-secondary">{globalItems.length + workspaceItems.length} entries collected from governance work.</p>
        </div>
        <KnowledgeSection title="Global" items={globalItems} />
        <KnowledgeSection title="Workspace" items={workspaceItems} />
      </div>
    </>
  );
}

function KnowledgeSection({ title, items }: { title: string; items: KnowledgeEntryDto[] }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-text-muted">{title}</h2>
      {items.length === 0 ? <div className="py-3 text-[13px] text-text-muted">暂无知识</div> : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {items.map((item) => <KnowledgeCard key={item.id} item={item} />)}
        </div>
      )}
    </section>
  );
}

function KnowledgeCard({ item }: { item: KnowledgeEntryDto }) {
  return (
    <div className="rounded-lg border border-white/6 bg-surface-1 p-4 transition-colors hover:bg-surface-2">
      <div className="mb-2 flex items-center gap-2">
        <span className="truncate text-[13px] font-medium text-text-primary">{item.title}</span>
        <span className="shrink-0 rounded bg-shell-600/15 px-1.5 py-0.5 text-[10px] font-medium text-shell-400">{item.scope}</span>
      </div>
      <p className="line-clamp-3 text-[12px] leading-5 text-text-secondary">{item.content.slice(0, 160)}</p>
    </div>
  );
}
