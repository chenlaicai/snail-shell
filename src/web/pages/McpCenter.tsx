/**
 * MCP Center - MCP 服务器管理
 */

import { useQuery } from "@tanstack/react-query";
import { metaQueries } from "../queries/meta.queries";

export function McpCenter() {
  const { data: mcps = [], isLoading } = useQuery(metaQueries.mcps());

  if (isLoading) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">加载中...</div>;

  return (
    <div className="flex flex-col h-full min-h-0" data-view-pane="mcps">
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <div className="flex items-center gap-4 p-3 px-6 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
          <div className="flex items-baseline gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">MCPs</span>
            <span className="text-[11px] text-[var(--color-text-grey)]">{mcps.length} 个</span>
          </div>
        </div>
        <div className="p-6 overflow-auto flex-1">
          {mcps.length === 0 ? (
            <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">暂无 MCP Server</div>
          ) : (
            <div className="grid gap-2">
              {mcps.map((m) => (
                <div key={m.name} className="flex gap-2.5 py-3 px-3.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-muted)] rounded-[var(--radius-sm)] mb-1.5 cursor-pointer transition-all duration-150 relative hover:border-[var(--color-border-default)] hover:bg-[var(--color-bg-active)]">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[13px] font-semibold text-[var(--color-text-primary)] flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{m.name}</span>
                      {m.builtin && <span className="text-[10px] text-[var(--color-text-grey)] font-mono shrink-0">内置</span>}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)] leading-normal mb-2 line-clamp-2">{m.url || "无连接信息"}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
