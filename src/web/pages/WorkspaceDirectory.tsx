import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { workspaceQueries } from "../queries/workspace.queries";

export function WorkspaceDirectory() {
  const navigate = useNavigate();
  const { data: workspaces = [], isLoading, error } = useQuery(workspaceQueries.list());

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-bg-base)]" data-view-pane="workspaces">
      <header className="flex items-center justify-between border-b border-[var(--color-border-muted)] px-[var(--space-xl)] py-[var(--space-lg)]">
        <div>
          <h1 className="text-[var(--font-size-2xl)] font-semibold text-[var(--color-text-primary)]">Workspaces</h1>
          <p className="mt-[var(--space-xs)] text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
            管理本地项目入口，并进入对应的 issue 协作看板。
          </p>
        </div>
        <button
          type="button"
          className="rounded-[var(--radius-md)] border border-[var(--color-accent)] bg-[var(--color-bg-elevated)] px-[var(--space-md)] py-[var(--space-xs)] text-[var(--font-size-sm)] font-medium text-[var(--color-accent)] transition-colors hover:bg-[rgba(108,141,250,0.08)]"
          onClick={() => navigate("/workspaces/new")}
        >
          新建工作区
        </button>
      </header>

      <main className="flex-1 overflow-auto px-[var(--space-xl)] py-[var(--space-lg)]">
        {isLoading && <div className="text-[var(--color-text-muted)]">正在加载工作区...</div>}

        {error && <div className="text-[var(--color-danger-text)]">加载工作区失败</div>}

        {!isLoading && !error && workspaces.length === 0 && (
          <section className="flex min-h-[320px] flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-[var(--space-xl)] text-center">
            <h2 className="text-[var(--font-size-lg)] font-semibold text-[var(--color-text-primary)]">暂无工作区</h2>
            <p className="mt-[var(--space-sm)] max-w-[420px] text-[var(--font-size-sm)] leading-[1.6] text-[var(--color-text-secondary)]">
              创建第一个工作区后，Snail Shell 会基于该项目组织 issue、stage 和 AI 协作上下文。
            </p>
            <button
              type="button"
              className="mt-[var(--space-lg)] rounded-[var(--radius-md)] bg-[var(--color-accent)] px-[var(--space-lg)] py-[var(--space-sm)] text-[var(--font-size-sm)] font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90"
              onClick={() => navigate("/workspaces/new")}
            >
              创建工作区
            </button>
          </section>
        )}

        {!isLoading && !error && workspaces.length > 0 && (
          <section className="grid gap-[var(--space-md)]">
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                className="rounded-[var(--radius-lg)] border border-[var(--color-border-muted)] bg-[var(--color-bg-surface)] p-[var(--space-lg)] text-left transition-colors hover:border-[var(--color-border-default)] hover:bg-[var(--color-bg-elevated)]"
                onClick={() => navigate(`/workspaces/${workspace.id}`)}
              >
                <div className="font-semibold text-[var(--color-text-primary)]">{workspace.summary || workspace.path}</div>
                <div className="mt-[var(--space-xs)] truncate text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">{workspace.path}</div>
              </button>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
