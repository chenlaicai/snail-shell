/**
 * Snail Den - 模板管理
 */

import { useEffect, useState } from "react";
import { api } from "../services/api-client";
import { showToast } from "../components/Toast";
import type { SnailDenTemplateDto } from "../types";

export function SnailDen() {
  const [templates, setTemplates] = useState<SnailDenTemplateDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("GET /api/snail-den")
      .then(setTemplates)
      .catch((err) => showToast(`加载模板失败：${err.message}`, true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">加载中...</div>;

  return (
    <div className="flex flex-col h-full min-h-0" data-view-pane="snail-den">
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <div className="flex items-center gap-4 p-3 px-6 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
          <div className="flex items-baseline gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">Snail Den</span>
            <span className="text-[11px] text-[var(--color-text-grey)]">{templates.length} 个模板</span>
          </div>
        </div>
        <div className="p-6 overflow-auto flex-1">
          {templates.length === 0 ? (
            <div className="empty-state">暂无模板</div>
          ) : (
            <div className="grid gap-2">
              {templates.map((t) => (
                <div key={t.id} className="flex gap-2.5 py-3 px-3.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-muted)] rounded-[var(--radius-sm)] mb-1.5 cursor-pointer transition-all duration-150 relative hover:border-[var(--color-border-default)] hover:bg-[var(--color-bg-active)]">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[13px] font-semibold text-[var(--color-text-primary)] flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{t.name}</span>
                      <span className="text-[10px] text-[var(--color-text-grey)] font-mono shrink-0">{t.id}</span>
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)] leading-normal mb-2 line-clamp-2">
                      {t.runtime && `${t.runtime}`}
                      {t.model && ` · ${t.model}`}
                      {t.contextWindow && ` · ${Math.round(t.contextWindow / 1000)}K`}
                    </div>
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
