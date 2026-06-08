/**
 * SOP Center — 标准作业流程管理
 *
 * 功能：列表、详情、创建、删除 SOP
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api-client.js";
import { sopQueries } from "@/queries/sop.queries.js";
import { useCreateSop, useDeleteSop } from "@/mutations/sop.mutations.js";
import { Button } from "@/components/ui/button.js";
import { Dialog } from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import { Badge } from "@/components/ui/badge.js";
import { showToast } from "@/components/Toast.js";
import type { SopDefinition, SnapshotRoleDefinition, CreateSopInput } from "@/sop/types.js";

type Mode = "list" | "detail" | "create";

export function SopCenter() {
  const { data: sops = [], isLoading } = useQuery(sopQueries.list());
  const createMutation = useCreateSop();
  const deleteMutation = useDeleteSop();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SopDefinition | null>(null);
  const [mode, setMode] = useState<Mode>("list");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);

  // 表单状态
  const [formName, setFormName] = useState("");
  const [formKey, setFormKey] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formFirstStage, setFormFirstStage] = useState("");
  const [formStagesJson, setFormStagesJson] = useState("");
  const [formTransitionsJson, setFormTransitionsJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

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
      await deleteMutation.mutateAsync(sopId);
      showToast("SOP 已删除");
      if (selectedId === sopId) {
        setSelectedId(null);
        setDetail(null);
        setMode("list");
      }
    } catch (err: unknown) {
      showToast(`删除失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  function startCreate() {
    resetForm();
    setMode("create");
  }

  function resetForm() {
    setFormName("");
    setFormKey("");
    setFormDescription("");
    setFormFirstStage("");
    setFormStagesJson("");
    setFormTransitionsJson("");
    setJsonError(null);
  }

  async function handleCreate() {
    if (!formName.trim() || !formKey.trim()) {
      showToast("名称和 key 不能为空", true);
      return;
    }

    let stages: CreateSopInput["stages"] = [];
    let transitions: CreateSopInput["transitions"] = [];

    if (formStagesJson.trim()) {
      try {
        stages = JSON.parse(formStagesJson);
        setJsonError(null);
      } catch {
        setJsonError("stages JSON 格式错误");
        return;
      }
    }
    if (formTransitionsJson.trim()) {
      try {
        transitions = JSON.parse(formTransitionsJson);
      } catch {
        setJsonError("transitions JSON 格式错误");
        return;
      }
    }

    try {
      await createMutation.mutateAsync({
        key: formKey.trim(),
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        first_stage: formFirstStage.trim() || stages[0]?.key || "",
        stages,
        transitions,
      });
      showToast("SOP 已创建");
      setMode("list");
      resetForm();
    } catch (err: unknown) {
      showToast(`创建失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">
        加载中...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-view-pane="sops">
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        {/* Header */}
        <div className="flex items-center gap-4 p-3 px-6 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
          <div className="flex items-baseline gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">SOP Center</span>
            <span className="text-[11px] text-[var(--color-text-grey)]">{sops.length} 个流程</span>
          </div>
          <Button size="sm" onClick={startCreate}>+ 新 SOP</Button>
        </div>

        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* 左侧：SOP 列表 */}
          <div className="w-[280px] shrink-0 border-r border-[var(--color-border-muted)] overflow-auto p-[var(--space-md)]">
            {sops.length === 0 ? (
              <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">暂无 SOP</div>
            ) : (
              sops.map((sop) => (
                <div
                  key={sop.sop.id}
                  className={`cursor-pointer p-[var(--space-sm)] rounded-[var(--radius-sm)] mb-1 transition-colors ${
                    selectedId === sop.sop.id
                      ? "bg-[var(--color-bg-active)] text-[var(--color-accent)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]"
                  }`}
                  onClick={() => selectSop(sop.sop.id)}
                >
                  <div className="font-semibold text-[var(--font-size-sm)]">{sop.sop.name}</div>
                  <div className="text-[var(--font-size-xs)] text-[var(--color-text-grey)]">
                    {sop.sop.source === "platform" ? "Platform" : "Workspace"} · {sop.sop.key}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 右侧：详情/创建 */}
          <div className="flex-1 overflow-auto p-[var(--space-xl)]">
            {mode === "create" && (
              <SopForm
                name={formName}
                description={formDescription}
                sopKey={formKey}
                firstStage={formFirstStage}
                stagesJson={formStagesJson}
                transitionsJson={formTransitionsJson}
                jsonError={jsonError}
                onNameChange={setFormName}
                onDescriptionChange={setFormDescription}
                onKeyChange={setFormKey}
                onFirstStageChange={setFormFirstStage}
                onStagesJsonChange={setFormStagesJson}
                onTransitionsJsonChange={setFormTransitionsJson}
                onSubmit={handleCreate}
                onCancel={() => { setMode("list"); resetForm(); }}
                submitLabel="创建"
                isPending={createMutation.isPending}
              />
            )}

            {mode === "detail" && detail && (
              <SopDetailView
                detail={detail}
                onDelete={() => confirmDelete(detail.sop.id)}
              />
            )}

            {mode === "list" && !detail && (
              <div className="text-[var(--color-text-muted)] text-[var(--font-size-base)] py-[var(--space-sm)]">
                选择一个 SOP 查看详情
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title="确认删除">
        <p>确定删除此 SOP？已创建的 Issue 不受影响（使用快照）。</p>
        <div className="flex gap-2 justify-end mt-[var(--space-lg)]">
          <Button variant="outline" onClick={() => setConfirmOpen(false)}>取消</Button>
          <Button variant="destructive" onClick={handleConfirmDelete}>确定</Button>
        </div>
      </Dialog>
    </div>
  );
}

// ─── SOP 详情视图 ─────────────────────────────────────

function SopDetailView({
  detail,
  onDelete,
}: {
  detail: SopDefinition;
  onDelete: () => void;
}) {
  const rolesByStage = new Map<string, SnapshotRoleDefinition[]>();
  for (const role of detail.roles) {
    const list = rolesByStage.get(role.stage_key) ?? [];
    list.push(role);
    rolesByStage.set(role.stage_key, list);
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-[var(--space-lg)]">
        <div>
          <h2 className="m-0 text-[var(--font-size-lg)]">{detail.sop.name}</h2>
          <div className="text-[var(--font-size-xs)] text-[var(--color-text-grey)] mt-1">
            {detail.sop.source} · {detail.sop.key}
          </div>
        </div>
        <div className="flex gap-[var(--space-sm)]">
          <Button variant="destructive" size="sm" onClick={onDelete}>删除</Button>
        </div>
      </div>

      {detail.sop.description && (
        <p className="text-[var(--color-text-secondary)] mb-[var(--space-lg)]">{detail.sop.description}</p>
      )}

      {/* 转移图 */}
      {detail.transitions.length > 0 && (
        <div className="mb-[var(--space-lg)]">
          <h3 className="text-[var(--font-size-md)] mb-[var(--space-md)]">阶段转移</h3>
          <div className="flex flex-wrap gap-2">
            {detail.transitions.map((t) => (
              <Badge key={t.id} variant="outline">
                {t.from_stage_key} → {t.to_stage_key}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* 阶段定义 */}
      <h3 className="text-[var(--font-size-md)] mb-[var(--space-md)]">阶段定义</h3>
      {detail.stages.length > 0 ? (
        <div className="grid gap-[var(--space-md)]">
          {[...detail.stages]
            .sort((a, b) => a.sequence - b.sequence)
            .map((stage) => {
              const roles = rolesByStage.get(stage.key) ?? [];
              return (
                <div
                  key={stage.key}
                  className="py-3 px-3.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-muted)] rounded-[var(--radius-sm)]"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[13px] font-semibold text-[var(--color-text-primary)] flex-1">
                      {stage.title}
                    </span>
                    <Badge variant="outline">#{stage.sequence}</Badge>
                  </div>
                  <div className="text-[var(--font-size-xs)] text-[var(--color-text-grey)] mb-2">{stage.key}</div>

                  {stage.output_description && (
                    <div className="text-[12px] text-[var(--color-text-secondary)] mb-2">
                      {stage.output_description}
                    </div>
                  )}

                  {roles.length > 0 && (
                    <div className="mt-[var(--space-sm)] flex flex-wrap gap-1.5">
                      {roles.map((role) => (
                        <span
                          key={role.id}
                          className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]"
                        >
                          {role.name}
                          {role.is_primary && " (主)"}
                          {role.count > 1 && ` ×${role.count}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      ) : (
        <div className="text-[var(--color-text-muted)] py-[var(--space-sm)]">暂无阶段定义</div>
      )}
    </div>
  );
}

// ─── SOP 创建表单 ─────────────────────────────────────

function SopForm({
  name, description, sopKey, firstStage, stagesJson, transitionsJson, jsonError,
  onNameChange, onDescriptionChange, onKeyChange, onFirstStageChange,
  onStagesJsonChange, onTransitionsJsonChange,
  onSubmit, onCancel, submitLabel, isPending,
}: {
  name: string;
  description: string;
  sopKey: string;
  firstStage: string;
  stagesJson: string;
  transitionsJson: string;
  jsonError: string | null;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onKeyChange: (v: string) => void;
  onFirstStageChange: (v: string) => void;
  onStagesJsonChange: (v: string) => void;
  onTransitionsJsonChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  isPending?: boolean;
}) {
  return (
    <div className="max-w-[600px]">
      <h2 className="mb-[var(--space-lg)]">新建 SOP</h2>

      <div className="mb-[var(--space-md)]">
        <label className="block mb-1 text-[var(--font-size-sm)]">名称 *</label>
        <Input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="SOP 名称" />
      </div>

      <div className="mb-[var(--space-md)]">
        <label className="block mb-1 text-[var(--font-size-sm)]">Key *</label>
        <Input value={sopKey} onChange={(e) => onKeyChange(e.target.value)} placeholder="唯一标识（用作文件名）" />
      </div>

      <div className="mb-[var(--space-md)]">
        <label className="block mb-1 text-[var(--font-size-sm)]">描述</label>
        <Textarea value={description} onChange={(e) => onDescriptionChange(e.target.value)} placeholder="可选描述" rows={3} />
      </div>

      <div className="mb-[var(--space-md)]">
        <label className="block mb-1 text-[var(--font-size-sm)]">入口阶段 Key</label>
        <Input value={firstStage} onChange={(e) => onFirstStageChange(e.target.value)} placeholder="留空则取第一个阶段" />
      </div>

      <div className="mb-[var(--space-md)]">
        <label className="block mb-1 text-[var(--font-size-sm)]">阶段定义 (JSON)</label>
        <Textarea
          className="font-mono"
          value={stagesJson}
          onChange={(e) => onStagesJsonChange(e.target.value)}
          placeholder={`[{"key":"design","title":"设计","sequence":1,"roles":[{"key":"designer","name":"架构师","is_primary":true}]}]`}
          rows={6}
        />
      </div>

      <div className="mb-[var(--space-lg)]">
        <label className="block mb-1 text-[var(--font-size-sm)]">转移定义 (JSON)</label>
        <Textarea
          className="font-mono"
          value={transitionsJson}
          onChange={(e) => onTransitionsJsonChange(e.target.value)}
          placeholder={`[{"from":"design","to":"development"}]`}
          rows={4}
        />
      </div>

      {jsonError && (
        <div className="mb-[var(--space-md)] text-[13px] text-destructive">{jsonError}</div>
      )}

      <div className="flex gap-[var(--space-sm)]">
        <Button onClick={onSubmit} disabled={isPending}>
          {isPending ? "创建中..." : submitLabel}
        </Button>
        <Button variant="outline" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}
