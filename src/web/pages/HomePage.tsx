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
    <div className="flex flex-col h-full min-h-0" data-view-pane="workspaces">
      <div className="flex flex-col flex-1 overflow-hidden min-w-0 items-center justify-center">
        <div className="text-center max-w-[480px]">
          <div className="text-[48px] mb-[var(--space-lg)]">🐌</div>
          <h1 className="text-[var(--font-size-xl)] mb-[var(--space-md)]">
            欢迎使用 Snail Shell
          </h1>
          <p className="text-[var(--color-text-secondary)] mb-[var(--space-xl)] leading-[1.6]">
            Snail Shell 是一个 AI 协作平台，帮助你管理项目、跟踪进度、与 AI 助手高效协作。
          </p>
          <div className="flex gap-[var(--space-md)] justify-center">
            <button className="bg-[var(--color-bg-elevated)] text-[var(--color-accent)] border border-[var(--color-accent)] rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-all hover:bg-[rgba(108,141,250,0.08)]" onClick={() => navigate("/workspaces")}>
              进入工作区
            </button>
            <button className="bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] border border-[var(--color-border-muted)] rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-all hover:border-[var(--color-border-default)] hover:text-[var(--color-text-primary)]" onClick={() => navigate("/workspaces/new")}>
              新建工作区
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
