import { useEffect, useState } from "react";
import { api } from "../services/api";

interface EvolutionItem {
  id: string;
  title: string;
  type: string;
  status: string;
  created_at: string;
}

export function EvolutionCenter() {
  const [items, setItems] = useState<EvolutionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("GET", "/evolution/items?limit=100")
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="task-board-empty">加载中...</div>;

  return (
    <div className="task-board-panel view-pane is-active" data-view-pane="evolution">
      <div className="task-board">
        <div className="board-header">
          <div className="board-title-area">
            <span className="board-title">Evolution Center</span>
            <span className="board-subtitle">{items.length} 项</span>
          </div>
        </div>
        <div className="page-content">
          {items.length === 0 ? (
            <div className="empty-state">暂无演进项</div>
          ) : (
            <div className="card-grid">
              {items.map((item) => (
                <div key={item.id} className="task-card">
                  <div className="task-body">
                    <div className="task-top-row">
                      <span className="task-title">{item.title}</span>
                      <span className="task-id">{item.type}</span>
                    </div>
                    <div className="task-meta">
                      <span className="task-stage-tag">{item.status}</span>
                      <span className="task-time">{new Date(item.created_at).toLocaleDateString()}</span>
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
