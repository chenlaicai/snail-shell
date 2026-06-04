import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";

interface Workspace {
  id: string;
  name: string;
  module: string;
  summary: string;
  issue_count: number;
  boss_pending_count: number;
}

export function HomePage() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("GET", "/workspaces")
      .then(setWorkspaces)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="task-board-empty">加载中...</div>;

  return (
    <div className="task-board-panel view-pane is-active" data-view-pane="workspaces">
      <div className="task-board">
        {workspaces.length === 0 ? (
          <div className="task-board-empty">暂无工作区</div>
        ) : (
          <div className="board-header">
            <div className="board-title-area">
              <span className="board-title">工作区</span>
              <span className="board-subtitle">{workspaces.length} 个</span>
            </div>
          </div>
        )}
        {workspaces.length > 0 && (
          <div className="task-list" style={{ gridTemplateColumns: "1fr" }}>
            {workspaces.map((ws) => (
              <div
                key={ws.id}
                className="task-card"
                onClick={() => navigate(`/ws/${ws.id}`)}
                style={{ cursor: "pointer" }}
              >
                <div className="task-body">
                  <div className="task-top-row">
                    <span className="task-title">{ws.name}</span>
                  </div>
                  <div className="task-meta">
                    <span className="task-meta-item">{ws.module}</span>
                    <span className="task-meta-item">{ws.issue_count} Issues</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
