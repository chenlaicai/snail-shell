/**
 * Skill Center - 技能中心
 *
 * 功能：技能列表、详情查看、搜索
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { metaQueries } from "../queries/meta.queries";
import { Input } from "@/components/ui/input";
import type { SkillDto } from "../types";

export function SkillCenter() {
  const { data: skills = [], isLoading } = useQuery(metaQueries.skills());
  const [selected, setSelected] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<SkillDto | null>(null);

  const filteredSkills = skills.filter((s) =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  function selectSkill(name: string) {
    setSelected(name);
    const skill = skills.find((s) => s.name === name);
    setSelectedSkill(skill || null);
  }

  if (isLoading) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">加载中...</div>;

  return (
    <div className="flex flex-col h-full min-h-0" data-view-pane="skills">
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <div className="flex items-center gap-4 p-3 px-6 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
          <div className="flex items-baseline gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">Skill Center</span>
            <span className="text-[11px] text-[var(--color-text-grey)]">{skills.length} 个</span>
          </div>
        </div>
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* 左侧列表 */}
          <div className="w-[260px] shrink-0 border-r border-[var(--color-border-muted)] overflow-auto p-[var(--space-md)]">
            <div className="mb-[var(--space-sm)]">
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
                  className={`cursor-pointer px-[var(--space-sm)] py-[5px] rounded-[var(--radius-sm)] mb-px text-[var(--font-size-sm)] transition-colors ${
                    selected === s.name
                      ? "bg-[var(--color-bg-active)] text-[var(--color-accent)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]"
                  }`}
                  onClick={() => selectSkill(s.name)}
                >
                  {s.name}
                </div>
              ))
            )}
          </div>
          {/* 右侧详情 */}
          <div className="flex-1 overflow-auto p-[var(--space-xl)]">
            {selectedSkill ? (
              <div>
                <h2 className="mb-[var(--space-sm)] text-[var(--font-size-md)]">{selectedSkill.name}</h2>
                {selectedSkill.description && (
                  <p className="text-[var(--color-text-secondary)] mb-[var(--space-lg)]">{selectedSkill.description}</p>
                )}
                <div className="text-[var(--font-size-xs)] text-[var(--color-text-grey)]">
                  路径：{selectedSkill.dir_path}
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
