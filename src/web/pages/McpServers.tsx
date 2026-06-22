import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { metaQueries } from "@/queries/meta.queries";
import { TopBar } from "@/components/TopBar";

export function McpServers() {
  const { data: servers = [], isLoading } = useQuery(metaQueries.mcpServers());
  const [selected, setSelected] = useState<string | null>(null);

  const { data: detail, isLoading: isDetailLoading, error: detailError } = useQuery(metaQueries.mcpServerDetail(selected ?? ""));

  if (isLoading) return <div className="flex h-full items-center justify-center text-[13px] text-text-muted">加载中...</div>;

  return (
    <>
      <TopBar breadcrumbs={[{ label: "MCP Servers" }]} />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-[280px] shrink-0 overflow-y-auto border-r border-white/6 p-4">
          {servers.length === 0 ? (
            <div className="py-3 text-[13px] text-text-muted">暂无内建 MCP Server</div>
          ) : (
            servers.map((server) => (
              <button
                key={server.name}
                onClick={() => setSelected(server.name)}
                className={`mb-1 w-full rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                  selected === server.name
                    ? "bg-white/8 text-text-primary"
                    : "text-text-secondary hover:bg-white/5 hover:text-text-primary"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="truncate">{server.name}</span>
                  <span className="ml-2 shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-text-muted">
                    {server.tools.length} tools
                  </span>
                </div>
              </button>
            ))
          )}
        </aside>
        <main className="flex-1 overflow-y-auto p-6">
          {detail ? (
            <div className="max-w-4xl">
              <h1 className="mb-1 text-lg font-semibold text-text-primary">{detail.name}</h1>
              <div className="mb-4 flex items-center gap-3 text-[12px] text-text-secondary">
                <span>版本 {detail.version}</span>
                <span className="text-text-muted">|</span>
                <span>{detail.endpoint}</span>
              </div>
              <h2 className="mb-3 text-[13px] font-medium text-text-primary">Tools</h2>
              {isDetailLoading ? (
                <div className="text-[13px] text-text-muted">加载中...</div>
              ) : detail.tools.length === 0 ? (
                <div className="text-[13px] text-text-muted">该 Server 无注册工具</div>
              ) : (
                <div className="space-y-2">
                  {detail.tools.map((tool) => (
                    <div key={tool.name} className="rounded-lg border border-white/6 bg-surface-1 p-4">
                      <div className="mb-1 text-[13px] font-medium text-text-primary">{tool.name}</div>
                      <div className="text-[12px] leading-5 text-text-secondary">{tool.description || "无描述"}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : selected && !isDetailLoading && detailError ? (
            <div className="py-3 text-[13px] text-text-muted">Server 详情加载失败</div>
          ) : (
            <div className="py-3 text-[13px] text-text-muted">选择一个 MCP Server 查看详情</div>
          )}
        </main>
      </div>
    </>
  );
}
