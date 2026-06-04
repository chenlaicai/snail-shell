import { useEffect, useState } from "react";
import { api } from "../services/api";

interface Prompt {
  name: string;
  path: string;
  content?: string;
}

export function PromptCenter() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    api("GET", "/meta/prompts")
      .then(setPrompts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="task-board-empty">加载中...</div>;

  return (
    <div className="task-board-panel view-pane is-active" data-view-pane="prompts">
      <div className="task-board">
        <div className="board-header">
          <div className="board-title-area">
            <span className="board-title">Prompt Center</span>
            <span className="board-subtitle">{prompts.length} 个</span>
          </div>
        </div>
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ width: 240, borderRight: "1px solid var(--color-border-muted)", overflow: "auto", padding: "var(--space-md)" }}>
            {prompts.map((p) => (
              <div
                key={p.name}
                className={`nav-item${selected === p.name ? " active" : ""}`}
                onClick={() => setSelected(p.name)}
                style={{ cursor: "pointer", padding: "6px", borderRadius: 6 }}
              >
                <span style={{ fontSize: "var(--font-size-sm)" }}>{p.name}</span>
              </div>
            ))}
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "var(--space-xl)" }}>
            {selected ? (
              <pre style={{ fontSize: "var(--font-size-xs)", whiteSpace: "pre-wrap", color: "var(--color-text-secondary)" }}>
                {prompts.find((p) => p.name === selected)?.content || "无内容"}
              </pre>
            ) : (
              <div className="empty-state">选择一个 Prompt 查看详情</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
