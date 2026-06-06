/**
 * Skill Center - 技能中心
 *
 * 功能：技能列表、详情查看、搜索
 */

import { useEffect, useState } from "react";
import { api } from "../services/api-client";
import { showToast } from "../components/Toast";
import { Input } from "@/components/ui/input";
import type { SkillDto } from "../types";

export function SkillCenter() {
  const [skills, setSkills] = useState<SkillDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<SkillDto | null>(null);

  useEffect(() => {
    api("GET /api/meta/skills")
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

  if (loading) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">加载中...</div>;

  return (
    <div className="flex flex-col h-full min-h-0" data-view-pane="skills">
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <div className="flex items-center gap-4 p-3 px-6 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
          <div className="flex items-baseline gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">Skill Center</span>
            <span className="text-[11px] text-[var(--color-text-grey)]">{skills.length} 个</span>
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
              <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">无匹配结果</div>
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
                  路径：{selectedSkill.filePath}
                </div>
              </div>
            ) : (
              <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">选择一个 Skill 查看详情</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
