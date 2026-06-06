import { useNavigate } from "react-router-dom";

export function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px] flex-col gap-4">
      <div style={{ fontSize: "var(--font-size-lg)", color: "var(--color-text-primary)" }}>404</div>
      <div>页面不存在</div>
      <button className="bg-[var(--color-bg-elevated)] text-[var(--color-accent)] border border-[var(--color-accent)] rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-all hover:bg-[rgba(108,141,250,0.08)]" onClick={() => navigate("/")}>返回首页</button>
    </div>
  );
}
