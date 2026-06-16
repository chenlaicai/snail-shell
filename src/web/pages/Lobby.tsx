/**
 * Lobby - IM 大厅
 */

export function Lobby() {
  return (
    <div className="flex flex-col h-full min-h-0" data-view-pane="lobby">
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <div className="flex items-center gap-4 p-3 px-6 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
          <div className="flex items-baseline gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">IM 大厅</span>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-[var(--space-xl)]">
          <div className="max-w-[520px] text-[var(--color-text-muted)] text-[var(--font-size-base)] leading-relaxed">
            当前后端尚未暴露 IM Lobby HTTP 接口；此页面暂保留入口，等待接入当前 IM domain 的正式 Hono routes。
          </div>
        </div>
      </div>
    </div>
  );
}
