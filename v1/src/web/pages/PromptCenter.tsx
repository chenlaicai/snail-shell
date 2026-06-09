/**
 * Prompt Center - 提示词中心
 *
 * 功能：提示词列表、搜索、详情查看
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { metaQueries } from "../queries/meta.queries";
import { Input } from "@/components/ui/input";

export function PromptCenter() {
  const { data: prompts = [], isLoading } = useQuery(metaQueries.prompts());
  const [selected, setSelected] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedContent, setSelectedContent] = useState("");

  // 搜索过滤
  const filteredPrompts = prompts.filter((p) =>
    p.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 选择 prompt 查看详情
  async function selectPrompt(id: string) {
    setSelected(id);
    const prompt = prompts.find((p) => p.id === id);
    if (prompt?.content) {
      setSelectedContent(prompt.content);
    } else {
      // 如果内容未加载，尝试从 API 获取
      try {
        const data = await api("GET /api/meta/prompts/:promptId", { params: { promptId: id } });
        setSelectedContent(data.content || "无内容");
      } catch {
        setSelectedContent("无法加载内容");
      }
    }
  }

  if (isLoading) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">加载中...</div>;

  return (
    <div className="flex flex-col h-full min-h-0" data-view-pane="prompts">
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <div className="flex items-center gap-4 p-3 px-6 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
          <div className="flex items-baseline gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">Prompt Center</span>
            <span className="text-[11px] text-[var(--color-text-grey)]">{prompts.length} 个</span>
          </div>
        </div>
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* 左侧列表 */}
          <div className="w-[260px] shrink-0 border-r border-[var(--color-border-muted)] overflow-auto p-[var(--space-md)]">
            <div className="mb-[var(--space-sm)]">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索 Prompt..."
              />
            </div>
            {filteredPrompts.length === 0 ? (
              <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">无匹配结果</div>
            ) : (
              filteredPrompts.map((p) => (
                <div
                  key={p.id}
                  className={`cursor-pointer px-[var(--space-sm)] py-[5px] rounded-[var(--radius-sm)] mb-px text-[var(--font-size-sm)] transition-colors ${
                    selected === p.id
                      ? "bg-[var(--color-bg-active)] text-[var(--color-accent)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]"
                  }`}
                  onClick={() => selectPrompt(p.id)}
                >
                  {p.title}
                </div>
              ))
            )}
          </div>
          {/* 右侧内容 */}
          <div className="flex-1 overflow-auto p-[var(--space-xl)]">
            {selected ? (
              <div>
                <h2 className="mb-[var(--space-lg)] text-[var(--font-size-md)]">
                  {prompts.find((p) => p.id === selected)?.title || selected}
                </h2>
                <pre className="text-[var(--font-size-xs)] whitespace-pre-wrap text-[var(--color-text-secondary)] leading-relaxed p-[var(--space-md)] bg-[var(--color-bg-elevated)] rounded-[var(--radius-sm)]">
                  {selectedContent}
                </pre>
              </div>
            ) : (
              <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">选择一个 Prompt 查看详情</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
