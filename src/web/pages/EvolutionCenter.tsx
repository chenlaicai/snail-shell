/**
 * Evolution Center - 演进中心
 *
 * 功能：列表、详情、创建演进项
 */

import { useEffect, useState } from "react";
import { api } from "../services/api";
import { showToast } from "../components/Toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

interface EvolutionItem {
  id: string;
  title: string;
  type: string;
  status: string;
  content?: string;
  workspace_id?: string;
  created_at: string;
  updated_at?: string;
}

export function EvolutionCenter() {
  const [items, setItems] = useState<EvolutionItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<EvolutionItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"list" | "detail" | "create">("list");

  // 创建表单
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formType, setFormType] = useState("preference");

  useEffect(() => {
    loadItems();
  }, []);

  async function loadItems() {
    setLoading(true);
    try {
      const data = await api("GET", "/evolution/items?limit=100");
      setItems(data);
    } catch (err: unknown) {
      showToast(`加载演进项失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
    setLoading(false);
  }

  async function selectItem(itemId: string) {
    try {
      const data = await api("GET", `/evolution/items/${itemId}`);
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
      await api("POST", "/evolution/items", {
        title: formTitle.trim(),
        content: formContent.trim(),
        type: formType,
      });
      showToast("演进项已创建");
      setMode("list");
      setFormTitle("");
      setFormContent("");
      loadItems();
    } catch (err: unknown) {
      showToast(`创建失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  if (loading) return <div className="task-board-empty">加载中...</div>;

  return (
    <div className="task-board-panel view-pane is-active" data-view-pane="evolution">
      <div className="task-board">
        <div className="board-header">
          <div className="board-title-area">
            <span className="board-title">Evolution Center</span>
            <span className="board-subtitle">{items.length} 项</span>
          </div>
          <div className="board-actions">
            <Button size="sm" onClick={() => { setMode("create"); setFormTitle(""); setFormContent(""); }}>+ 新增</Button>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* 左侧列表 */}
          <div style={{ width: 300, borderRight: "1px solid var(--color-border-muted)", overflow: "auto", padding: "var(--space-md)" }}>
            {items.length === 0 ? (
              <div className="empty-state">暂无演进项</div>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className={`nav-item${selectedItem?.id === item.id ? " active" : ""}`}
                  onClick={() => selectItem(item.id)}
                  style={{ cursor: "pointer", padding: "8px", borderRadius: 6, marginBottom: 4 }}
                >
                  <div style={{ fontWeight: 600, fontSize: "var(--font-size-sm)" }}>{item.title}</div>
                  <div style={{ display: "flex", gap: "var(--space-xs)", marginTop: 4 }}>
                    <Badge variant="outline">{item.type}</Badge>
                    <Badge variant={item.status === "governed" ? "default" : "secondary"}>{item.status}</Badge>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 右侧详情/创建 */}
          <div style={{ flex: 1, overflow: "auto", padding: "var(--space-xl)" }}>
            {mode === "create" && (
              <div style={{ maxWidth: 480 }}>
                <h2 style={{ marginBottom: "var(--space-lg)" }}>新增演进项</h2>
                <div style={{ marginBottom: "var(--space-md)" }}>
                  <label style={{ display: "block", marginBottom: 4, fontSize: "var(--font-size-sm)" }}>标题</label>
                  <Input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="演进项标题" />
                </div>
                <div style={{ marginBottom: "var(--space-md)" }}>
                  <label style={{ display: "block", marginBottom: 4, fontSize: "var(--font-size-sm)" }}>类型</label>
                  <select value={formType} onChange={(e) => setFormType(e.target.value)} style={{ width: "100%", padding: "var(--space-sm)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-default)", background: "var(--color-bg-input)", color: "var(--color-text-primary)" }}>
                    <option value="preference">偏好</option>
                    <option value="rule">规则</option>
                    <option value="pattern">模式</option>
                    <option value="lesson">教训</option>
                    <option value="decision">决策</option>
                  </select>
                </div>
                <div style={{ marginBottom: "var(--space-lg)" }}>
                  <label style={{ display: "block", marginBottom: 4, fontSize: "var(--font-size-sm)" }}>内容</label>
                  <Textarea value={formContent} onChange={(e) => setFormContent(e.target.value)} placeholder="详细描述" rows={5} />
                </div>
                <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                  <Button onClick={handleCreate}>创建</Button>
                  <Button variant="outline" onClick={() => setMode("list")}>取消</Button>
                </div>
              </div>
            )}

            {mode === "detail" && selectedItem && (
              <div>
                <div style={{ marginBottom: "var(--space-lg)" }}>
                  <h2 style={{ margin: 0 }}>{selectedItem.title}</h2>
                  <div style={{ display: "flex", gap: "var(--space-xs)", marginTop: "var(--space-sm)" }}>
                    <Badge variant="outline">{selectedItem.type}</Badge>
                    <Badge variant={selectedItem.status === "governed" ? "default" : "secondary"}>{selectedItem.status}</Badge>
                  </div>
                  <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-grey)", marginTop: 4 }}>
                    创建于 {new Date(selectedItem.created_at).toLocaleString()}
                  </div>
                </div>
                {selectedItem.content && (
                  <div style={{ padding: "var(--space-md)", background: "var(--color-bg-elevated)", borderRadius: "var(--radius-sm)", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                    {selectedItem.content}
                  </div>
                )}
              </div>
            )}

            {mode === "list" && !selectedItem && (
              <div className="empty-state">选择一个演进项查看详情</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
