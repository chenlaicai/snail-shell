import { useEffect, useState } from "react";
import { api } from "../services/api";

interface Template {
  id: string;
  name: string;
  description?: string;
}

export function SnailDen() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("GET", "/snail-den")
      .then(setTemplates)
      .catch(() => {})
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
                    {t.description && <div className="task-summary">{t.description}</div>}
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
