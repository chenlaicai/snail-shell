/**
 * Prompt Center - 提示词中心
 *
 * 功能：提示词列表、搜索、详情查看
 */

import { useEffect, useState } from "react";
import { api } from "../services/api-client";
import { showToast } from "../components/Toast";
import { Input } from "@/components/ui/input";
import type { PromptDto } from "../types";

export function PromptCenter() {
  const [prompts, setPrompts] = useState<PromptDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedContent, setSelectedContent] = useState("");

  useEffect(() => {
    api("GET /api/meta/prompts")
      .then(setPrompts)
      .catch((err) => showToast(`加载 Prompt 失败：${err.message}`, true))
      .finally(() => setLoading(false));
  }, []);

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
          {/* 左侧列表 */}
          <div style={{ width: 260, borderRight: "1px solid var(--color-border-muted)", overflow: "auto", padding: "var(--space-md)" }}>
            <div style={{ marginBottom: "var(--space-sm)" }}>
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索 Prompt..."
              />
            </div>
            {filteredPrompts.length === 0 ? (
              <div className="empty-state">无匹配结果</div>
            ) : (
              filteredPrompts.map((p) => (
                <div
                  key={p.id}
                  className={`nav-item${selected === p.id ? " active" : ""}`}
                  onClick={() => selectPrompt(p.id)}
                  style={{ cursor: "pointer", padding: "6px 8px", borderRadius: 6, marginBottom: 2, fontSize: "var(--font-size-sm)" }}
                >
                  {p.title}
                </div>
              ))
            )}
          </div>
          {/* 右侧内容 */}
          <div style={{ flex: 1, overflow: "auto", padding: "var(--space-xl)" }}>
            {selected ? (
              <div>
                <h2 style={{ marginBottom: "var(--space-lg)", fontSize: "var(--font-size-md)" }}>
                  {prompts.find((p) => p.id === selected)?.title || selected}
                </h2>
                <pre style={{ fontSize: "var(--font-size-xs)", whiteSpace: "pre-wrap", color: "var(--color-text-secondary)", lineHeight: 1.6, padding: "var(--space-md)", background: "var(--color-bg-elevated)", borderRadius: "var(--radius-sm)" }}>
                  {selectedContent}
                </pre>
              </div>
            ) : (
              <div className="empty-state">选择一个 Prompt 查看详情</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
