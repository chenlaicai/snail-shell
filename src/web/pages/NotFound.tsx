import { useNavigate } from "react-router-dom";

export function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-[13px] text-text-muted">
      <div className="text-lg font-semibold text-text-primary">404</div>
      <div>页面不存在</div>
      <button className="rounded-md border border-shell-600/40 bg-surface-2 px-2.5 py-1 text-xs font-medium text-shell-400 transition-colors hover:bg-shell-600/10" onClick={() => navigate("/")}>返回首页</button>
    </div>
  );
}
