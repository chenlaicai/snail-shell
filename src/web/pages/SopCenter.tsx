import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api-client";
import { sopQueries } from "@/queries/sop.queries";
import { showToast } from "@/components/Toast";
import { Badge } from "@/components/ui/badge";
import { TopBar } from "@/components/TopBar";
import type { SopDetailDto } from "@/types";

export function SopCenter() {
  const { data: sops = [], isLoading } = useQuery(sopQueries.list());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<SopDetailDto | null>(null);

  async function selectSop(sopKey: string) {
    setSelectedKey(sopKey);
    try {
      setDetail(await api("GET /api/sops/:sopKey", { params: { sopKey } }));
    } catch (err: unknown) {
      showToast(`加载 SOP 详情失败：${err instanceof Error ? err.message : String(err)}`, true);
      setDetail(null);
    }
  }

  if (isLoading) return <div className="flex h-full items-center justify-center text-[13px] text-text-muted">加载中...</div>;

  return (
    <>
      <TopBar breadcrumbs={[{ label: "SOP Center" }]} />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-[300px] shrink-0 overflow-y-auto border-r border-white/6 p-4">
          <div className="mb-3 flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wider text-text-muted">SOPs</span><span className="text-[11px] text-text-muted">{sops.length}</span></div>
          {sops.length === 0 ? <div className="py-3 text-[13px] text-text-muted">暂无 SOP</div> : sops.map((sop) => (
            <button key={sop.key} onClick={() => selectSop(sop.key)} className={`mb-1 w-full rounded-lg p-3 text-left transition-colors ${selectedKey === sop.key ? "bg-white/8 text-text-primary" : "text-text-secondary hover:bg-white/5 hover:text-text-primary"}`}>
              <div className="text-[13px] font-medium">{sop.name}</div>
              <div className="mt-1 font-mono text-[10px] text-text-muted">{sop.scope} · {sop.key}</div>
            </button>
          ))}
        </aside>

        <main className="flex-1 overflow-y-auto p-6">
          {detail ? (
            <div className="max-w-4xl">
              <div className="mb-6"><h1 className="text-xl font-semibold text-text-primary">{detail.name}</h1><div className="mt-1 font-mono text-[11px] text-text-muted">{detail.scope} · {detail.key}</div></div>
              {detail.description && <p className="mb-6 text-[13px] leading-6 text-text-secondary">{detail.description}</p>}
              <h2 className="mb-3 text-sm font-medium text-text-primary">阶段定义</h2>
              {detail.stage_definitions.length > 0 ? (
                <div className="grid gap-3">
                  {detail.stage_definitions.map((stage) => (
                    <div key={stage.key} className="rounded-lg border border-white/6 bg-surface-1 p-4">
                      <div className="mb-2 flex items-center gap-2"><span className="text-[13px] font-medium text-text-primary">{stage.title}</span><Badge variant="outline">{stage.key}</Badge></div>
                      {stage.description && <div className="text-[12px] leading-5 text-text-muted">{stage.description}</div>}
                      {stage.roles.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{stage.roles.map((role) => <Badge key={role.key ?? role.name} variant={role.is_primary ? "default" : "secondary"}>{role.name}{role.is_primary ? " 主" : ""}</Badge>)}</div>}
                    </div>
                  ))}
                </div>
              ) : <div className="py-3 text-[13px] text-text-muted">暂无阶段定义</div>}
            </div>
          ) : <div className="py-3 text-[13px] text-text-muted">选择一个 SOP 查看详情</div>}
        </main>
      </div>
    </>
  );
}
