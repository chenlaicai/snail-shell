/**
 * MCP Center - MCP 服务器管理
 */

import { useEffect, useState } from "react";
import { api } from "../services/api-client";
import { showToast } from "../components/Toast";
import type { McpServerDto } from "../types";

export function McpCenter() {
  const [mcps, setMcps] = useState<McpServerDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("GET /api/meta/mcps")
      .then(setMcps)
      .catch((err) => showToast(`加载 MCP 列表失败：${err.message}`, true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="task-board-empty">加载中...</div>;

  return (
    <div className="task-board-panel view-pane is-active" data-view-pane="mcps">
      <div className="task-board">
        <div className="board-header">
          <div className="board-title-area">
            <span className="board-title">MCPs</span>
            <span className="board-subtitle">{mcps.length} 个</span>
          </div>
        </div>
        <div className="page-content">
          {mcps.length === 0 ? (
            <div className="empty-state">暂无 MCP Server</div>
          ) : (
            <div className="card-grid">
              {mcps.map((m) => (
                <div key={m.name} className="task-card">
                  <div className="task-body">
                    <div className="task-top-row">
                      <span className="task-title">{m.name}</span>
                      {m.builtin && <span className="task-id">内置</span>}
                    </div>
                    <div className="task-summary">{m.url || "无连接信息"}</div>
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
