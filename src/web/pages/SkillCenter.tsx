import { useEffect, useState } from "react";
import { api } from "../services/api";

interface Skill {
  name: string;
  description?: string;
  path: string;
}

export function SkillCenter() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("GET", "/meta/skills")
      .then(setSkills)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="task-board-empty">加载中...</div>;

  return (
    <div className="task-board-panel view-pane is-active" data-view-pane="skills">
      <div className="task-board">
        <div className="board-header">
          <div className="board-title-area">
            <span className="board-title">Skill Center</span>
            <span className="board-subtitle">{skills.length} 个</span>
          </div>
        </div>
        <div style={{ padding: "var(--space-xl)", overflow: "auto", flex: 1 }}>
          {skills.length === 0 ? (
            <div className="empty-state">暂无 Skill</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {skills.map((s) => (
                <div key={s.name} className="task-card">
                  <div className="task-body">
                    <div className="task-top-row">
                      <span className="task-title">{s.name}</span>
                    </div>
                    {s.description && <div className="task-summary">{s.description}</div>}
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
