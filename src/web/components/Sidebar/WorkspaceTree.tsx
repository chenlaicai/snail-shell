import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../services/api";

interface Workspace {
  id: string;
  name: string;
  boss_pending_count: number;
}

export function WorkspaceTree() {
  const navigate = useNavigate();
  const { workspaceId } = useParams();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  useEffect(() => {
    api("GET", "/workspaces").then(setWorkspaces).catch(() => {});
  }, []);

  if (workspaces.length === 0) {
    return <div className="empty-state">暂无工作区</div>;
  }

  return (
    <>
      {workspaces.map((ws) => {
        const isActive = workspaceId === ws.id;
        return (
          <div key={ws.id} className={`tree-workspace-node${isActive ? " active" : ""}`}>
            <button className="tree-workspace" type="button" onClick={() => navigate(`/ws/${ws.id}`)}>
              <span>
                <span className="node-header">
                  <span className="node-main">
                    <span className="chevron">{isActive ? "▾" : "▸"}</span>
                    <span className="node-title">{ws.name}</span>
                  </span>
                  {ws.boss_pending_count > 0 && (
                    <span className="pending-badge">@{ws.boss_pending_count}</span>
                  )}
                </span>
              </span>
            </button>
          </div>
        );
      })}
    </>
  );
}
