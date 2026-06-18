import { useQuery } from "@tanstack/react-query";
import { metaQueries } from "@/queries/meta.queries";
import { TopBar } from "@/components/TopBar";

export function SnailDen() {
  const { data: templates = [], isLoading } = useQuery(metaQueries.snailDen());
  if (isLoading) return <div className="flex h-full items-center justify-center text-[13px] text-text-muted">加载中...</div>;

  return (
    <>
      <TopBar breadcrumbs={[{ label: "Snail Den" }]} />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mb-6"><h1 className="text-xl font-semibold text-text-primary">Snail Den</h1><p className="mt-1 text-[13px] text-text-secondary">{templates.length} templates</p></div>
        {templates.length === 0 ? <div className="py-4 text-[13px] text-text-muted">暂无模板</div> : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {templates.map((t) => (
              <div key={t.key} className="rounded-lg border border-white/6 bg-surface-1 p-4 transition-colors hover:bg-surface-2">
                <div className="mb-2 flex items-center gap-2"><span className="truncate text-[13px] font-medium text-text-primary">{t.name}</span><span className="shrink-0 font-mono text-[10px] text-text-muted">{t.key}</span></div>
                <div className="text-[12px] leading-5 text-text-secondary">{t.agent_name} · {t.model}{t.context_window ? ` · ${Math.round(t.context_window / 1000)}K` : ""}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
