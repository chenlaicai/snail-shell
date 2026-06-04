import { useNavigate } from "react-router-dom";

export function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="task-board-empty" style={{ flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: "var(--font-size-lg)", color: "var(--color-text-primary)" }}>404</div>
      <div>页面不存在</div>
      <button className="primary-button" onClick={() => navigate("/")}>返回首页</button>
    </div>
  );
}
