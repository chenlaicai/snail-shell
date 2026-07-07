import { useNavigate } from "react-router-dom";

export function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-surface-0 px-6">
      <div className="max-w-[560px] text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-shell-500 to-shell-800 text-3xl shadow-[0_20px_60px_rgba(200,114,52,0.18)]">🐌</div>
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">欢迎使用 Snail Shell</h1>
        <p className="mt-3 text-[14px] leading-7 text-text-secondary">
          管理 workspace、跟踪 issue、推进 stage，并与 Snail 协作完成复杂任务。
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <button
            className="rounded-md bg-shell-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-shell-500"
            onClick={() => navigate("/workspaces")}
          >
            进入工作区
          </button>
          <button
            className="rounded-md border border-white/6 px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
            onClick={() => navigate("/workspaces/new")}
          >
            新建工作区
          </button>
        </div>
      </div>
    </div>
  );
}
