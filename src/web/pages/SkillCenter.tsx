/**
 * Skill Center - 技能中心
 *
 * 功能：技能列表、详情查看、搜索
 */

import { useEffect, useState } from "react";
import { api } from "../services/api";
import { showToast } from "../components/Toast";
import { Input } from "@/components/ui/input";

interface Skill {
  name: string;
  description?: string;
  path: string;
  content?: string;
}

export function SkillCenter() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

  useEffect(() => {
    api("GET", "/meta/skills")
      .then(setSkills)
      .catch((err) => showToast(`加载 Skill 失败：${err.message}`, true))
      .finally(() => setLoading(false));
  }, []);

  const filteredSkills = skills.filter((s) =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  function selectSkill(name: string) {
    setSelected(name);
    const skill = skills.find((s) => s.name === name);
    setSelectedSkill(skill || null);
  }

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
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* 左侧列表 */}
          <div style={{ width: 260, borderRight: "1px solid var(--color-border-muted)", overflow: "auto", padding: "var(--space-md)" }}>
            <div style={{ marginBottom: "var(--space-sm)" }}>
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索 Skill..."
              />
            </div>
            {filteredSkills.length === 0 ? (
              <div className="empty-state">无匹配结果</div>
            ) : (
              filteredSkills.map((s) => (
                <div
                  key={s.name}
                  className={`nav-item${selected === s.name ? " active" : ""}`}
                  onClick={() => selectSkill(s.name)}
                  style={{ cursor: "pointer", padding: "6px 8px", borderRadius: 6, marginBottom: 2, fontSize: "var(--font-size-sm)" }}
                >
                  {s.name}
                </div>
              ))
            )}
          </div>
          {/* 右侧详情 */}
          <div style={{ flex: 1, overflow: "auto", padding: "var(--space-xl)" }}>
            {selectedSkill ? (
              <div>
                <h2 style={{ marginBottom: "var(--space-sm)", fontSize: "var(--font-size-md)" }}>{selectedSkill.name}</h2>
                {selectedSkill.description && (
                  <p style={{ color: "var(--color-text-secondary)", marginBottom: "var(--space-lg)" }}>{selectedSkill.description}</p>
                )}
                <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-grey)" }}>
                  路径：{selectedSkill.path}
                </div>
              </div>
            ) : (
              <div className="empty-state">选择一个 Skill 查看详情</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
