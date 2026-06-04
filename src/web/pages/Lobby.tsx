import { useEffect, useState } from "react";
import { api } from "../services/api";

interface LobbySession {
  id: string;
  channel: string;
  status: string;
  created_at: string;
  last_activity?: string;
}

export function Lobby() {
  const [sessions, setSessions] = useState<LobbySession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("GET", "/lobby/sessions")
      .then(setSessions)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="task-board-empty">加载中...</div>;

  return (
    <div className="task-board-panel view-pane is-active" data-view-pane="lobby">
      <div className="task-board">
        <div className="board-header">
          <div className="board-title-area">
            <span className="board-title">IM 大厅</span>
            <span className="board-subtitle">{sessions.length} 个会话</span>
          </div>
        </div>
        <div className="page-content">
          {sessions.length === 0 ? (
            <div className="empty-state">暂无活跃会话</div>
          ) : (
            <div className="card-grid">
              {sessions.map((s) => (
                <div key={s.id} className="task-card">
                  <div className="task-body">
                    <div className="task-top-row">
                      <span className="task-title">{s.channel}</span>
                      <span className="task-id">{s.id.slice(-6)}</span>
                    </div>
                    <div className="task-meta">
                      <span className="task-stage-tag">{s.status}</span>
                      <span className="task-time">{new Date(s.created_at).toLocaleString()}</span>
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
