import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { metaQueries } from "@/queries/meta.queries";
import { Input } from "@/components/ui/input";
import { TopBar } from "@/components/TopBar";
import type { SkillDto } from "@/types";

export function SkillCenter() {
  const { data: skills = [], isLoading } = useQuery(metaQueries.skills());
  const [selected, setSelected] = useState<SkillDto | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const filtered = skills.filter((skill) => skill.name.toLowerCase().includes(searchQuery.toLowerCase()));

  if (isLoading) return <div className="flex h-full items-center justify-center text-[13px] text-text-muted">加载中...</div>;

  return (
    <>
      <TopBar breadcrumbs={[{ label: "Skill Center" }]} />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-[280px] shrink-0 overflow-y-auto border-r border-white/6 p-4">
          <div className="mb-3"><Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="搜索 Skill..." /></div>
          {filtered.length === 0 ? <div className="py-3 text-[13px] text-text-muted">无匹配结果</div> : filtered.map((skill) => (
            <button key={skill.name} onClick={() => setSelected(skill)} className={`mb-1 w-full rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${selected?.name === skill.name ? "bg-white/8 text-text-primary" : "text-text-secondary hover:bg-white/5 hover:text-text-primary"}`}>{skill.name}</button>
          ))}
        </aside>
        <main className="flex-1 overflow-y-auto p-6">
          {selected ? (
            <div className="max-w-3xl"><h1 className="mb-2 text-lg font-semibold text-text-primary">{selected.name}</h1>{selected.description && <p className="mb-4 text-[13px] leading-6 text-text-secondary">{selected.description}</p>}<div className="text-[12px] text-text-muted">路径：{selected.dir_path}</div></div>
          ) : <div className="py-3 text-[13px] text-text-muted">选择一个 Skill 查看详情</div>}
        </main>
      </div>
    </>
  );
}
