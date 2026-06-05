/**
 * HomePage - 欢迎页
 *
 * 首页展示欢迎信息，不直接展示工作区列表。
 * 工作区通过侧栏导航访问。
 */

import { useNavigate } from "react-router-dom";

export function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="task-board-panel view-pane is-active" data-view-pane="workspaces">
      <div className="task-board" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", maxWidth: 480 }}>
          <div style={{ fontSize: 48, marginBottom: "var(--space-lg)" }}>🐌</div>
          <h1 style={{ fontSize: "var(--font-size-xl)", marginBottom: "var(--space-md)" }}>
            欢迎使用 Snail Shell
          </h1>
          <p style={{ color: "var(--color-text-secondary)", marginBottom: "var(--space-xl)", lineHeight: 1.6 }}>
            Snail Shell 是一个 AI 协作平台，帮助你管理项目、跟踪进度、与 AI 助手高效协作。
          </p>
          <div style={{ display: "flex", gap: "var(--space-md)", justifyContent: "center" }}>
            <button
              className="primary-button"
              onClick={() => {
                // 从侧栏选择第一个工作区
                const firstWs = document.querySelector(".tree-workspace") as HTMLElement;
                firstWs?.click();
              }}
            >
              进入工作区
            </button>
            <button
              className="secondary-button"
              onClick={() => navigate("/ws/new")}
            >
              新建工作区
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
