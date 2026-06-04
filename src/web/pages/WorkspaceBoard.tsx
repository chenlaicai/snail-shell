import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "../services/api";

interface Workspace {
  id: string;
  name: string;
  issues: any[];
}

export function WorkspaceBoard() {
  const { workspaceId } = useParams();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    api("GET", `/workspaces/${workspaceId}`)
      .then(setWorkspace)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workspaceId]);

  if (loading) return <div className="task-board-empty">加载中...</div>;
  if (!workspace) return <div className="task-board-empty">工作区不存在</div>;

  return (
    <div className="task-board-panel view-pane is-active" data-view-pane="workspaces">
      <div className="task-board">
        <div className="board-header">
          <div className="board-title-area">
            <span className="board-title">{workspace.name}</span>
            <span className="board-subtitle">{workspace.issues?.length ?? 0} Issues</span>
          </div>
        </div>
        <div className="task-list" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          {["pending", "in_progress", "completed"].map((status) => (
            <div key={status} className="task-group">
              <div className="task-group-header">
                <span className="task-group-title">{status === "pending" ? "待处理" : status === "in_progress" ? "AI 工作中" : "已完成"}</span>
              </div>
              {(workspace.issues ?? [])
                .filter((issue: any) => {
                  if (status === "completed") return !!issue.closed_at;
                  if (status === "in_progress") return issue.current_stage?.status === "in_progress";
                  return !issue.closed_at && issue.current_stage?.status !== "in_progress";
                })
                .map((issue: any) => (
                  <div key={issue.id} className="task-card" style={{ cursor: "pointer" }}>
                    <div className="task-body">
                      <div className="task-top-row">
                        <span className="task-title">{issue.title}</span>
                        <span className="task-id">#{issue.id.slice(-6)}</span>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
