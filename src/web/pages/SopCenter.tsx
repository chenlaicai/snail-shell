/**
 * SOP Center - 标准作业流程管理
 *
 * 功能：列表、详情、创建、编辑、删除 SOP
 */

import { useEffect, useState } from "react";
import { api } from "../services/api-client";
import { showToast } from "../components/Toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { SopDto, SopDetailDto } from "../types";

type Mode = "list" | "detail" | "create" | "edit";

export function SopCenter() {
  const [sops, setSops] = useState<SopDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SopDetailDto | null>(null);
  const [mode, setMode] = useState<Mode>("list");
  const [loading, setLoading] = useState(true);

  // 表单状态
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formKey, setFormKey] = useState("");

  // 加载 SOP 列表
  useEffect(() => {
    loadSops();
  }, []);

  async function loadSops() {
    setLoading(true);
    try {
      const data = await api("GET /api/sops");
      setSops(data);
    } catch (err: unknown) {
      showToast(`加载 SOP 列表失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
    setLoading(false);
  }

  // 选择 SOP 查看详情
  async function selectSop(sopId: string) {
    setSelectedId(sopId);
    setMode("detail");
    try {
      const data = await api("GET /api/sops/:sopId", { params: { sopId } });
      setDetail(data);
    } catch (err: unknown) {
      showToast(`加载 SOP 详情失败：${err instanceof Error ? err.message : String(err)}`, true);
      setDetail(null);
    }
  }

  // 创建 SOP
  async function handleCreate() {
    if (!formName.trim() || !formKey.trim()) {
      showToast("名称和 key 不能为空", true);
      return;
    }
    try {
      await api("POST /api/sops", {
        body: {
          name: formName.trim(),
          description: formDescription.trim(),
          key: formKey.trim(),
        },
      });
      showToast("SOP 已创建");
      setMode("list");
      resetForm();
      loadSops();
    } catch (err: unknown) {
      showToast(`创建失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  // 编辑 SOP
  async function handleEdit() {
    if (!detail || !formName.trim()) return;
    try {
      await api("PATCH /api/sops/:sopId", {
        params: { sopId: detail.id },
        body: {
          name: formName.trim(),
          description: formDescription.trim(),
        },
      });
      showToast("SOP 已更新");
      setMode("detail");
      selectSop(detail.id);
    } catch (err: unknown) {
      showToast(`更新失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  // 删除 SOP
  async function handleDelete(sopId: string) {
    if (!confirm("确定删除此 SOP？")) return;
    try {
      await api("DELETE /api/sops/:sopId", { params: { sopId } });
      showToast("SOP 已删除");
      setSops((prev) => prev.filter((s) => s.id !== sopId));
      if (selectedId === sopId) {
        setSelectedId(null);
        setDetail(null);
        setMode("list");
      }
    } catch (err: unknown) {
      showToast(`删除失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  // 进入编辑模式
  function startEdit() {
    if (!detail) return;
    setFormName(detail.name);
    setFormDescription(detail.description || "");
    setFormKey(detail.key);
    setMode("edit");
  }

  // 进入创建模式
  function startCreate() {
    resetForm();
    setMode("create");
  }

  // 重置表单
  function resetForm() {
    setFormName("");
    setFormDescription("");
    setFormKey("");
  }

  if (loading) return <div className="task-board-empty">加载中...</div>;

  return (
    <div className="task-board-panel view-pane is-active" data-view-pane="sops">
      <div className="task-board">
        <div className="board-header">
          <div className="board-title-area">
            <span className="board-title">SOP Center</span>
            <span className="board-subtitle">{sops.length} 个流程</span>
          </div>
          <div className="board-actions">
            <Button size="sm" onClick={startCreate}>+ 新 SOP</Button>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* 左侧：SOP 列表 */}
          <div style={{ width: 280, borderRight: "1px solid var(--color-border-muted)", overflow: "auto", padding: "var(--space-md)" }}>
            {sops.length === 0 ? (
              <div className="empty-state">暂无 SOP</div>
            ) : (
              sops.map((sop) => (
                <div
                  key={sop.id}
                  className={`nav-item${selectedId === sop.id ? " active" : ""}`}
                  onClick={() => selectSop(sop.id)}
                  style={{ cursor: "pointer", padding: "8px", borderRadius: 6, marginBottom: 4 }}
                >
                  <div style={{ fontWeight: 600, fontSize: "var(--font-size-sm)" }}>{sop.name}</div>
                  <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-grey)" }}>
                    {sop.source === "platform" ? "Platform" : "Workspace"} · {sop.key}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 右侧：详情/编辑/创建 */}
          <div style={{ flex: 1, overflow: "auto", padding: "var(--space-xl)" }}>
            {mode === "create" && (
              <SopForm
                name={formName}
                description={formDescription}
                sopKey={formKey}
                onNameChange={setFormName}
                onDescriptionChange={setFormDescription}
                onKeyChange={setFormKey}
                onSubmit={handleCreate}
                onCancel={() => setMode("list")}
                submitLabel="创建"
              />
            )}

            {mode === "edit" && detail && (
              <SopForm
                name={formName}
                description={formDescription}
                sopKey={formKey}
                onNameChange={setFormName}
                onDescriptionChange={setFormDescription}
                onKeyChange={setFormKey}
                onSubmit={handleEdit}
                onCancel={() => setMode("detail")}
                submitLabel="保存"
                disableKey
              />
            )}

            {mode === "detail" && detail && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-lg)" }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "var(--font-size-lg)" }}>{detail.name}</h2>
                    <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-grey)", marginTop: 4 }}>
                      {detail.source} · {detail.key}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                    <Button variant="outline" size="sm" onClick={startEdit}>编辑</Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(detail.id)}>删除</Button>
                  </div>
                </div>
                {detail.description && (
                  <p style={{ color: "var(--color-text-secondary)", marginBottom: "var(--space-lg)" }}>{detail.description}</p>
                )}
                <h3 style={{ fontSize: "var(--font-size-md)", marginBottom: "var(--space-md)" }}>阶段定义</h3>
                {detail.stage_definitions && detail.stage_definitions.length > 0 ? (
                  <div style={{ display: "grid", gap: "var(--space-md)" }}>
                    {detail.stage_definitions.map((stage) => (
                      <div key={stage.key} className="task-card">
                        <div className="task-body">
                          <div className="task-top-row">
                            <span className="task-title">{stage.title}</span>
                            <Badge variant="outline">#{stage.sequence}</Badge>
                          </div>
                          <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-grey)", marginTop: 4 }}>
                            {stage.key}
                          </div>
                          {stage.roles && stage.roles.length > 0 && (
                            <div style={{ marginTop: "var(--space-sm)" }}>
                              {stage.roles.map((role) => (
                                <span key={role.key} style={{ fontSize: "var(--font-size-xs)", marginRight: "var(--space-sm)" }}>
                                  {role.name}{role.is_primary ? " (主)" : ""}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">暂无阶段定义</div>
                )}
              </div>
            )}

            {mode === "list" && !detail && (
              <div className="empty-state">选择一个 SOP 查看详情</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// SOP 表单组件
function SopForm({
  name, description, sopKey,
  onNameChange, onDescriptionChange, onKeyChange,
  onSubmit, onCancel, submitLabel, disableKey,
}: {
  name: string;
  description: string;
  sopKey: string;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onKeyChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  disableKey?: boolean;
}) {
  return (
    <div style={{ maxWidth: 480 }}>
      <h2 style={{ marginBottom: "var(--space-lg)" }}>{submitLabel === "创建" ? "新建 SOP" : "编辑 SOP"}</h2>
      <div style={{ marginBottom: "var(--space-md)" }}>
        <label style={{ display: "block", marginBottom: 4, fontSize: "var(--font-size-sm)" }}>名称</label>
        <Input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="SOP 名称" />
      </div>
      <div style={{ marginBottom: "var(--space-md)" }}>
        <label style={{ display: "block", marginBottom: 4, fontSize: "var(--font-size-sm)" }}>Key</label>
        <Input value={sopKey} onChange={(e) => onKeyChange(e.target.value)} placeholder="唯一标识" disabled={disableKey} />
      </div>
      <div style={{ marginBottom: "var(--space-lg)" }}>
        <label style={{ display: "block", marginBottom: 4, fontSize: "var(--font-size-sm)" }}>描述</label>
        <Textarea value={description} onChange={(e) => onDescriptionChange(e.target.value)} placeholder="可选描述" rows={3} />
      </div>
      <div style={{ display: "flex", gap: "var(--space-sm)" }}>
        <Button onClick={onSubmit}>{submitLabel}</Button>
        <Button variant="outline" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}
