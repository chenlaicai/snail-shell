/**
 * Snail Den - 模板管理
 */

import { useEffect, useState } from "react";
import { api } from "../services/api";
import { showToast } from "../components/Toast";
import type { SnailDenTemplateDto } from "../types";

export function SnailDen() {
  const [templates, setTemplates] = useState<SnailDenTemplateDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("GET", "/snail-den")
      .then(setTemplates)
      .catch((err) => showToast(`加载模板失败：${err.message}`, true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="task-board-empty">加载中...</div>;

  return (
    <div className="task-board-panel view-pane is-active" data-view-pane="snail-den">
      <div className="task-board">
        <div className="board-header">
          <div className="board-title-area">
            <span className="board-title">Snail Den</span>
            <span className="board-subtitle">{templates.length} 个模板</span>
          </div>
        </div>
        <div className="page-content">
          {templates.length === 0 ? (
            <div className="empty-state">暂无模板</div>
          ) : (
            <div className="card-grid">
              {templates.map((t) => (
                <div key={t.id} className="task-card">
                  <div className="task-body">
                    <div className="task-top-row">
                      <span className="task-title">{t.name}</span>
                      <span className="task-id">{t.id}</span>
                    </div>
                    <div className="task-summary">
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
