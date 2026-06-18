import { useQuery } from "@tanstack/react-query";
import { metaQueries } from "@/queries/meta.queries";
import { TopBar } from "@/components/TopBar";

export function McpCenter() {
  const { data: mcps = [], isLoading } = useQuery(metaQueries.mcps());
  if (isLoading) return <div className="flex h-full items-center justify-center text-[13px] text-text-muted">加载中...</div>;

  return (
    <>
      <TopBar breadcrumbs={[{ label: "MCPs" }]} />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mb-6"><h1 className="text-xl font-semibold text-text-primary">MCPs</h1><p className="mt-1 text-[13px] text-text-secondary">{mcps.length} servers</p></div>
        {mcps.length === 0 ? <div className="py-4 text-[13px] text-text-muted">暂无 MCP Server</div> : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {mcps.map((m) => (
              <div key={m.name} className="rounded-lg border border-white/6 bg-surface-1 p-4 transition-colors hover:bg-surface-2">
                <div className="mb-2 flex items-center gap-2"><span className="truncate text-[13px] font-medium text-text-primary">{m.name}</span></div>
                <div className="line-clamp-2 text-[12px] leading-5 text-text-secondary">{m.url || "无连接信息"}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
