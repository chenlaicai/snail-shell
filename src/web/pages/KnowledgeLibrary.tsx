import { useEffect, useState } from "react";
import { api } from "../services/api";
import type { KnowledgeEntryDto } from "../types";

export function KnowledgeLibrary() {
  const [globalItems, setGlobalItems] = useState<KnowledgeEntryDto[]>([]);
  const [workspaceItems, setWorkspaceItems] = useState<KnowledgeEntryDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api("GET", "/knowledge/items?scope=global&limit=50"),
      api("GET", "/knowledge/items?scope=workspace&limit=50"),
    ])
      .then(([g, w]) => { setGlobalItems(g); setWorkspaceItems(w); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="task-board-empty">加载中...</div>;

  return (
    <div className="task-board-panel view-pane is-active" data-view-pane="knowledge">
      <div className="task-board">
        <div className="board-header">
          <div className="board-title-area">
            <span className="board-title">知识库</span>
            <span className="board-subtitle">{globalItems.length + workspaceItems.length} 条</span>
          </div>
        </div>
        <div className="page-content">
          <h3 className="section-title">Global</h3>
          {globalItems.length === 0 ? <div className="empty-state">暂无全局知识</div> : (
            <div className="card-grid" style={{ marginBottom: 24 }}>
              {globalItems.map((item) => <KnowledgeCard key={item.id} item={item} />)}
            </div>
          )}
          <h3 className="section-title">Workspace</h3>
          {workspaceItems.length === 0 ? <div className="empty-state">暂无工作区知识</div> : (
            <div className="card-grid">
              {workspaceItems.map((item) => <KnowledgeCard key={item.id} item={item} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KnowledgeCard({ item }: { item: KnowledgeEntryDto }) {
  return (
    <div className="task-card">
      <div className="task-body">
        <div className="task-top-row">
          <span className="task-title">{item.title}</span>
          <span className="task-id">{item.scope}</span>
        </div>
        <div className="task-summary">{item.content.slice(0, 100)}</div>
      </div>
    </div>
  );
}
