/**
 * SOP Center - 标准作业流程管理
 *
 * 功能：列表、详情、创建、编辑、删除 SOP
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { sopQueries } from "../queries/sop.queries";
import { queryKeys } from "../queries/keys";
import { showToast } from "../components/Toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "../components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { SopDetailDto } from "../types";

type Mode = "list" | "detail" | "create" | "edit";

export function SopCenter() {
  const queryClient = useQueryClient();
  const { data: sops = [], isLoading } = useQuery(sopQueries.list());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SopDetailDto | null>(null);
  const [mode, setMode] = useState<Mode>("list");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);

  // 表单状态
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formKey, setFormKey] = useState("");

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
      queryClient.invalidateQueries({ queryKey: queryKeys.sops.all });
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
  function confirmDelete(sopId: string) {
    setConfirmTarget(sopId);
    setConfirmOpen(true);
  }

  async function handleConfirmDelete() {
    if (!confirmTarget) return;
    const sopId = confirmTarget;
    setConfirmOpen(false);
    setConfirmTarget(null);
    try {
      await api("DELETE /api/sops/:sopId", { params: { sopId } });
      showToast("SOP 已删除");
      queryClient.invalidateQueries({ queryKey: queryKeys.sops.all });
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

  if (isLoading) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">加载中...</div>;

  return (
    <div className="flex flex-col h-full min-h-0" data-view-pane="sops">
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <div className="flex items-center gap-4 p-3 px-6 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
          <div className="flex items-baseline gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">SOP Center</span>
            <span className="text-[11px] text-[var(--color-text-grey)]">{sops.length} 个流程</span>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" onClick={startCreate}>+ 新 SOP</Button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* 左侧：SOP 列表 */}
          <div className="w-[280px] shrink-0 border-r border-[var(--color-border-muted)] overflow-auto p-[var(--space-md)]">
            {sops.length === 0 ? (
              <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">暂无 SOP</div>
            ) : (
              sops.map((sop) => (
                <div
                  key={sop.id}
                  className={`cursor-pointer p-[var(--space-sm)] rounded-[var(--radius-sm)] mb-1 transition-colors ${
                    selectedId === sop.id
                      ? "bg-[var(--color-bg-active)] text-[var(--color-accent)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]"
                  }`}
                  onClick={() => selectSop(sop.id)}
                >
                  <div className="font-semibold text-[var(--font-size-sm)]">{sop.name}</div>
                  <div className="text-[var(--font-size-xs)] text-[var(--color-text-grey)]">
                    {sop.source === "platform" ? "Platform" : "Workspace"} · {sop.key}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 右侧：详情/编辑/创建 */}
          <div className="flex-1 overflow-auto p-[var(--space-xl)]">
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
                <div className="flex justify-between items-center mb-[var(--space-lg)]">
                  <div>
                    <h2 className="m-0 text-[var(--font-size-lg)]">{detail.name}</h2>
                    <div className="text-[var(--font-size-xs)] text-[var(--color-text-grey)] mt-1">
                      {detail.source} · {detail.key}
                    </div>
                  </div>
                  <div className="flex gap-[var(--space-sm)]">
                    <Button variant="outline" size="sm" onClick={startEdit}>编辑</Button>
                    <Button variant="destructive" size="sm" onClick={() => confirmDelete(detail.id)}>删除</Button>
                  </div>
                </div>
                {detail.description && (
                  <p className="text-[var(--color-text-secondary)] mb-[var(--space-lg)]">{detail.description}</p>
                )}
                <h3 className="text-[var(--font-size-md)] mb-[var(--space-md)]">阶段定义</h3>
                {detail.stage_definitions && detail.stage_definitions.length > 0 ? (
                  <div className="grid gap-[var(--space-md)]">
                    {detail.stage_definitions.map((stage) => (
                      <div key={stage.key} className="flex gap-2.5 py-3 px-3.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-muted)] rounded-[var(--radius-sm)] mb-1.5 cursor-pointer transition-all duration-150 relative hover:border-[var(--color-border-default)] hover:bg-[var(--color-bg-active)]">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-[13px] font-semibold text-[var(--color-text-primary)] flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{stage.title}</span>
                            <Badge variant="outline">#{stage.sequence}</Badge>
                          </div>
                          <div className="text-[var(--font-size-xs)] text-[var(--color-text-grey)] mt-1">
                            {stage.key}
                          </div>
                          {stage.roles && stage.roles.length > 0 && (
                            <div className="mt-[var(--space-sm)]">
                              {stage.roles.map((role) => (
                                <span key={role.key} className="text-[var(--font-size-xs)] mr-[var(--space-sm)]">
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
                  <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">暂无阶段定义</div>
                )}
              </div>
            )}

            {mode === "list" && !detail && (
              <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">选择一个 SOP 查看详情</div>
            )}
          </div>
        </div>
      </div>
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title="确认删除">
        <p>确定删除此 SOP？</p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => setConfirmOpen(false)}>取消</Button>
          <Button variant="destructive" onClick={handleConfirmDelete}>确定</Button>
        </div>
      </Dialog>
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
    <div className="max-w-[480px]">
      <h2 className="mb-[var(--space-lg)]">{submitLabel === "创建" ? "新建 SOP" : "编辑 SOP"}</h2>
      <div className="mb-[var(--space-md)]">
        <label className="block mb-1 text-[var(--font-size-sm)]">名称</label>
        <Input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="SOP 名称" />
      </div>
      <div className="mb-[var(--space-md)]">
        <label className="block mb-1 text-[var(--font-size-sm)]">Key</label>
        <Input value={sopKey} onChange={(e) => onKeyChange(e.target.value)} placeholder="唯一标识" disabled={disableKey} />
      </div>
      <div className="mb-[var(--space-lg)]">
        <label className="block mb-1 text-[var(--font-size-sm)]">描述</label>
        <Textarea value={description} onChange={(e) => onDescriptionChange(e.target.value)} placeholder="可选描述" rows={3} />
      </div>
      <div className="flex gap-[var(--space-sm)]">
        <Button onClick={onSubmit}>{submitLabel}</Button>
        <Button variant="outline" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}
