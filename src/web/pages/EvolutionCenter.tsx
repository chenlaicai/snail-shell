/**
 * Evolution Center - 演进中心
 *
 * 功能：列表、详情、创建演进项
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { evolutionQueries } from "../queries/evolution.queries";
import { queryKeys } from "../queries/keys";
import { showToast } from "../components/Toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { EvolutionItem } from "../types";

export function EvolutionCenter() {
  const queryClient = useQueryClient();
  const { data: items = [], isLoading } = useQuery(evolutionQueries.list({ limit: 100 }));
  const [selectedItem, setSelectedItem] = useState<EvolutionItem | null>(null);
  const [mode, setMode] = useState<"list" | "detail" | "create">("list");

  // 创建表单
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formType, setFormType] = useState("preference");

  async function selectItem(itemId: string) {
    try {
      const data = await api("GET /api/evolution/items/:itemId", { params: { itemId } });
      setSelectedItem(data);
      setMode("detail");
    } catch (err: unknown) {
      showToast(`加载详情失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  async function handleCreate() {
    if (!formTitle.trim()) {
      showToast("标题不能为空", true);
      return;
    }
    try {
      await api("POST /api/evolution/items", {
        body: {
          title: formTitle.trim(),
          content: formContent.trim(),
          type: formType,
        },
      });
      showToast("演进项已创建");
      setMode("list");
      setFormTitle("");
      setFormContent("");
      queryClient.invalidateQueries({ queryKey: queryKeys.evolution.list() });
    } catch (err: unknown) {
      showToast(`创建失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  if (isLoading) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">加载中...</div>;

  return (
    <div className="flex flex-col h-full min-h-0" data-view-pane="evolution">
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <div className="flex items-center gap-4 p-3 px-6 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
          <div className="flex items-baseline gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">Evolution Center</span>
            <span className="text-[11px] text-[var(--color-text-grey)]">{items.length} 项</span>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => { setMode("create"); setFormTitle(""); setFormContent(""); }}>+ 新增</Button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* 左侧列表 */}
          <div className="w-[300px] shrink-0 border-r border-[var(--color-border-muted)] overflow-auto p-[var(--space-md)]">
            {items.length === 0 ? (
              <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">暂无演进项</div>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className={`cursor-pointer p-[var(--space-sm)] rounded-[var(--radius-sm)] mb-1 transition-colors ${
                    selectedItem?.id === item.id
                      ? "bg-[var(--color-bg-active)] text-[var(--color-accent)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]"
                  }`}
                  onClick={() => selectItem(item.id)}
                >
                  <div className="font-semibold text-[var(--font-size-sm)]">{item.title}</div>
                  <div className="flex gap-1 mt-1">
                    {item.tags?.slice(0, 2).map((tag: string) => (
                      <Badge key={tag} variant="outline">{tag}</Badge>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 右侧详情/创建 */}
          <div className="flex-1 overflow-auto p-[var(--space-xl)]">
            {mode === "create" && (
              <div className="max-w-[480px]">
                <h2 className="mb-[var(--space-lg)]">新增演进项</h2>
                <div className="mb-[var(--space-md)]">
                  <label className="block mb-1 text-[var(--font-size-sm)]">标题</label>
                  <Input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="演进项标题" />
                </div>
                <div className="mb-[var(--space-md)]">
                  <label className="block mb-1 text-[var(--font-size-sm)]">类型</label>
                  <select value={formType} onChange={(e) => setFormType(e.target.value)} className="w-full p-[var(--space-sm)] rounded-[var(--radius-sm)] border border-[var(--color-border-default)] bg-[var(--color-bg-input)] text-[var(--color-text-primary)]">
                    <option value="preference">偏好</option>
                    <option value="rule">规则</option>
                    <option value="pattern">模式</option>
                    <option value="lesson">教训</option>
                    <option value="decision">决策</option>
                  </select>
                </div>
                <div className="mb-[var(--space-lg)]">
                  <label className="block mb-1 text-[var(--font-size-sm)]">内容</label>
                  <Textarea value={formContent} onChange={(e) => setFormContent(e.target.value)} placeholder="详细描述" rows={5} />
                </div>
                <div className="flex gap-[var(--space-sm)]">
                  <Button onClick={handleCreate}>创建</Button>
                  <Button variant="outline" onClick={() => setMode("list")}>取消</Button>
                </div>
              </div>
            )}

            {mode === "detail" && selectedItem && (
              <div>
                <div className="mb-[var(--space-lg)]">
                  <h2 className="m-0">{selectedItem.title}</h2>
                  <div className="flex gap-1 mt-[var(--space-sm)]">
                    {selectedItem.tags?.map((tag: string) => (
                      <Badge key={tag} variant="outline">{tag}</Badge>
                    ))}
                  </div>
                  <div className="text-[var(--font-size-xs)] text-[var(--color-text-grey)] mt-1">
                    创建于 {new Date(selectedItem.created_at).toLocaleString()}
                  </div>
                </div>
                {selectedItem.content && (
                  <div className="p-[var(--space-md)] bg-[var(--color-bg-elevated)] rounded-[var(--radius-sm)] whitespace-pre-wrap leading-relaxed">
                    {selectedItem.content}
                  </div>
                )}
              </div>
            )}

            {mode === "list" && !selectedItem && (
              <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">选择一个演进项查看详情</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
