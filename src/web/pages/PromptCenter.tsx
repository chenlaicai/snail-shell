import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { metaQueries } from "@/queries/meta.queries";
import { Input } from "@/components/ui/input";
import { TopBar } from "@/components/TopBar";

export function PromptCenter() {
  const { data: prompts = [], isLoading } = useQuery(metaQueries.prompts());
  const [selected, setSelected] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const filtered = prompts.filter((prompt) => prompt.title.toLowerCase().includes(searchQuery.toLowerCase()));
  const selectedPrompt = prompts.find((prompt) => prompt.id === selected) ?? null;

  if (isLoading) return <div className="flex h-full items-center justify-center text-[13px] text-text-muted">加载中...</div>;

  return (
    <>
      <TopBar breadcrumbs={[{ label: "Prompt Center" }]} />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-[280px] shrink-0 overflow-y-auto border-r border-white/6 p-4">
          <div className="mb-3"><Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="搜索 Prompt..." /></div>
          {filtered.length === 0 ? <div className="py-3 text-[13px] text-text-muted">无匹配结果</div> : filtered.map((prompt) => (
            <button key={prompt.id} onClick={() => setSelected(prompt.id)} className={`mb-1 w-full rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${selected === prompt.id ? "bg-white/8 text-text-primary" : "text-text-secondary hover:bg-white/5 hover:text-text-primary"}`}>{prompt.title}</button>
          ))}
        </aside>
        <main className="flex-1 overflow-y-auto p-6">
          {selectedPrompt ? (
            <div className="max-w-4xl"><h1 className="mb-4 text-lg font-semibold text-text-primary">{selectedPrompt.title}</h1><pre className="rounded-lg border border-white/6 bg-surface-1 p-4 whitespace-pre-wrap text-[12px] leading-6 text-text-secondary">{selectedPrompt.content || "无内容"}</pre></div>
          ) : <div className="py-3 text-[13px] text-text-muted">选择一个 Prompt 查看详情</div>}
        </main>
      </div>
    </>
  );
}
