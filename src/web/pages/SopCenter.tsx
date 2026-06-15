/**
 * SOP Center - 标准作业流程查看
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { sopQueries } from "../queries/sop.queries";
import { showToast } from "../components/Toast";
import { Badge } from "@/components/ui/badge";
import type { SopDetailDto } from "../types";

export function SopCenter() {
  const { data: sops = [], isLoading } = useQuery(sopQueries.list());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<SopDetailDto | null>(null);

  async function selectSop(sopKey: string) {
    setSelectedKey(sopKey);
    try {
      const data = await api("GET /api/sops/:sopKey", { params: { sopKey } });
      setDetail(data);
    } catch (err: unknown) {
      showToast(`加载 SOP 详情失败：${err instanceof Error ? err.message : String(err)}`, true);
      setDetail(null);
    }
  }

  if (isLoading) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">加载中...</div>;

  return (
    <div className="flex flex-col h-full min-h-0" data-view-pane="sops">
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <div className="flex items-center gap-4 p-3 px-6 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
          <div className="flex items-baseline gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">SOP Center</span>
            <span className="text-[11px] text-[var(--color-text-grey)]">{sops.length} 个流程</span>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden min-h-0">
          <div className="w-[280px] shrink-0 border-r border-[var(--color-border-muted)] overflow-auto p-[var(--space-md)]">
            {sops.length === 0 ? (
              <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">暂无 SOP</div>
            ) : (
              sops.map((sop) => (
                <div
                  key={sop.key}
                  className={`cursor-pointer p-[var(--space-sm)] rounded-[var(--radius-sm)] mb-1 transition-colors ${
                    selectedKey === sop.key
                      ? "bg-[var(--color-bg-active)] text-[var(--color-accent)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]"
                  }`}
                  onClick={() => selectSop(sop.key)}
                >
                  <div className="font-semibold text-[var(--font-size-sm)]">{sop.name}</div>
                  <div className="text-[var(--font-size-xs)] text-[var(--color-text-grey)]">
                    {sop.scope} · {sop.key}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex-1 overflow-auto p-[var(--space-xl)]">
            {detail ? (
              <div>
                <div className="mb-[var(--space-lg)]">
                  <h2 className="m-0 text-[var(--font-size-lg)]">{detail.name}</h2>
                  <div className="text-[var(--font-size-xs)] text-[var(--color-text-grey)] mt-1">
                    {detail.scope} · {detail.key}
                  </div>
                </div>
                {detail.description && (
                  <p className="text-[var(--color-text-secondary)] mb-[var(--space-lg)]">{detail.description}</p>
                )}
                <h3 className="text-[var(--font-size-md)] mb-[var(--space-md)]">阶段定义</h3>
                {detail.stage_definitions.length > 0 ? (
                  <div className="grid gap-[var(--space-md)]">
                    {detail.stage_definitions.map((stage) => (
                      <div key={stage.key} className="flex gap-2.5 py-3 px-3.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-muted)] rounded-[var(--radius-sm)] mb-1.5">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-[13px] font-semibold text-[var(--color-text-primary)] flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{stage.title}</span>
                            <Badge variant="outline">{stage.key}</Badge>
                          </div>
                          {stage.description && <div className="text-[var(--font-size-xs)] text-[var(--color-text-grey)] mt-1">{stage.description}</div>}
                          {stage.roles.length > 0 && (
                            <div className="mt-[var(--space-sm)]">
                              {stage.roles.map((role) => (
                                <span key={role.key ?? role.name} className="text-[var(--font-size-xs)] mr-[var(--space-sm)]">
                                  {role.name}{role.is_primary ? " (主)" : ""}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">暂无阶段定义</div>
                )}
              </div>
            ) : (
              <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">选择一个 SOP 查看详情</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
