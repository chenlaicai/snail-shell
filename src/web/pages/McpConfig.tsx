import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { metaQueries } from "@/queries/meta.queries";
import { TopBar } from "@/components/TopBar";
import type { McpConfigDto } from "@api-contracts/dto";

const sourceLabel: Record<string, { label: string; color: string }> = {
  builtin: { label: "builtin", color: "bg-white/10 text-text-muted" },
  platform: { label: "platform", color: "bg-blue-500/15 text-blue-400" },
  workspace: { label: "workspace", color: "bg-green-500/15 text-green-400" },
};

function SourceTag({ source }: { source?: string }) {
  if (!source) return null;
  const cfg = sourceLabel[source];
  if (!cfg) return null;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] ${cfg.color}`}>{cfg.label}</span>;
}

function transportInfo(m: McpConfigDto): string {
  if (m.command) return `stdio: ${m.command}${m.args?.length ? ` ${m.args.join(" ")}` : ""}`;
  if (m.url) return `HTTP: ${m.url}`;
  return "无连接信息";
}

export function McpConfig() {
  const { data: mcpConfigs = [], isLoading } = useQuery(metaQueries.mcpConfigs());
  const [selected, setSelected] = useState<string | null>(null);
  const selectedConfig = mcpConfigs.find((m) => m.name === selected) ?? null;

  if (isLoading) return <div className="flex h-full items-center justify-center text-[13px] text-text-muted">加载中...</div>;

  return (
    <>
      <TopBar breadcrumbs={[{ label: "MCP Config" }]} />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-[280px] shrink-0 overflow-y-auto border-r border-white/6 p-4">
          {mcpConfigs.length === 0 ? (
            <div className="py-3 text-[13px] text-text-muted">暂无 MCP 配置</div>
          ) : (
            mcpConfigs.map((m) => (
              <button
                key={m.name}
                onClick={() => setSelected(m.name)}
                className={`mb-1 w-full rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                  selected === m.name
                    ? "bg-white/8 text-text-primary"
                    : "text-text-secondary hover:bg-white/5 hover:text-text-primary"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="truncate">{m.name}</span>
                  <SourceTag source={m.source} />
                </div>
              </button>
            ))
          )}
        </aside>
        <main className="flex-1 overflow-y-auto p-6">
          {selectedConfig ? (
            <div className="max-w-4xl">
              <h1 className="mb-1 text-lg font-semibold text-text-primary">{selectedConfig.name}</h1>
              <div className="mb-4 flex items-center gap-2">
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-text-secondary">{selectedConfig.scope}</span>
                <SourceTag source={selectedConfig.source} />
                {selectedConfig.source === "workspace" && selectedConfig.workspace_path && (
                  <span className="text-[11px] text-text-muted">{selectedConfig.workspace_path}</span>
                )}
              </div>
              <div className="rounded-lg border border-white/6 bg-surface-1 p-4">
                <div className="mb-2 text-[13px] font-medium text-text-primary">Transport</div>
                <div className="text-[12px] leading-5 text-text-secondary">{transportInfo(selectedConfig)}</div>
              </div>
            </div>
          ) : (
            <div className="py-3 text-[13px] text-text-muted">选择一个配置项查看详情</div>
          )}
        </main>
      </div>
    </>
  );
}
