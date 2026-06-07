import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useConversationStore } from "../stores/conversationStore";
import { api } from "../services/api-client";
import { metaQueries } from "../queries/meta.queries";
import { queryKeys } from "../queries/keys";
import { showToast } from "./Toast";
import type { WorkspaceSummaryDto, IssueDto, Participant, RoleDefinition, StageDetailDto } from "../types";

export function ContextPanel({
  workspace,
  issue,
}: {
  workspace: WorkspaceSummaryDto | null;
  issue: IssueDto | null;
}) {
  const { currentStage, currentConversation, wsStatus } = useConversationStore();
  const [newArtifactKey, setNewArtifactKey] = useState("");
  const [newArtifactValue, setNewArtifactValue] = useState("");

  // TanStack Query: stage detail
  const { data: stageDetail } = useQuery({
    queryKey: queryKeys.stages.detail(currentStage?.id ?? ""),
    queryFn: (): Promise<StageDetailDto> => api("GET /api/stages/:stageId", { params: { stageId: currentStage!.id } }),
    enabled: !!currentStage?.id,
  });

  // TanStack Query: templates
  const { data: templates = [] } = useQuery(metaQueries.snailDen());

  // 从 stageDetail 和 conversation 参与角色计算参与者列表
  const participants = useMemo((): Participant[] => {
    if (!stageDetail) return [];
    const roleDefs = stageDetail.role_definitions || [];
    const convRoles = currentConversation?.participating_roles || [];
    const participantMap = new Map<string, Participant>();
    roleDefs.forEach((rd: RoleDefinition) => {
      participantMap.set(rd.name, { name: rd.name, roleDef: rd, isPrimary: rd.is_primary || false });
    });
    convRoles.forEach((name: string) => {
      if (!participantMap.has(name)) {
        participantMap.set(name, { name, roleDef: null, isPrimary: false });
      }
    });
    return Array.from(participantMap.values());
  }, [stageDetail, currentConversation?.participating_roles]);

  const queryClient = useQueryClient();
  /** 将 Record<string, unknown> 安全转为 Record<string, string>，避免 as 断言 */
  const toStringRecord = (r: Record<string, unknown> | undefined): Record<string, string> => {
    if (!r) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) out[k] = String(v ?? "");
    return out;
  };
  const outputArtifacts = useMemo(() => toStringRecord(stageDetail?.output_artifacts), [stageDetail?.output_artifacts]);
  const inputArtifacts = useMemo(() => toStringRecord(stageDetail?.input_artifacts), [stageDetail?.input_artifacts]);

  const stageQueryKey = queryKeys.stages.detail(currentStage?.id ?? "");

  const addArtifactMutation = useMutation({
    mutationFn: (updated: Record<string, string>) => {
      if (!currentStage) throw new Error("No active stage");
      return api("PATCH /api/stages/:stageId", { params: { stageId: currentStage.id }, body: { output_artifacts: updated } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stageQueryKey });
      setNewArtifactKey("");
      setNewArtifactValue("");
      showToast("已添加输出产物");
    },
    onError: (err: Error) => showToast(`添加失败：${err.message}`, true),
  });

  const removeArtifactMutation = useMutation({
    mutationFn: (updated: Record<string, string>) => {
      if (!currentStage) throw new Error("No active stage");
      return api("PATCH /api/stages/:stageId", { params: { stageId: currentStage.id }, body: { output_artifacts: updated } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stageQueryKey });
      showToast("已移除输出产物");
    },
    onError: (err: Error) => showToast(`移除失败：${err.message}`, true),
  });

  const templateMutation = useMutation({
    mutationFn: ({ roleName, templateId }: { roleName: string; templateId: string }) => {
      if (!issue || !currentStage) throw new Error("No active issue or stage");
      return api("PATCH /api/issues/:issueId/role-snail", {
        params: { issueId: issue.id },
        body: { stage_id: currentStage.id, role_name: roleName, snail_template_id: templateId },
      });
    },
    onSuccess: (_data, { roleName }) => showToast(`已切换 ${roleName} 的模板`),
    onError: (err: Error) => showToast(`切换失败：${err.message}`, true),
  });

  function handleAddArtifact() {
    if (!currentStage || !newArtifactKey.trim() || !newArtifactValue.trim()) return;
    addArtifactMutation.mutate({ ...outputArtifacts, [newArtifactKey.trim()]: newArtifactValue.trim() });
  }

  function handleRemoveArtifact(key: string) {
    if (!currentStage) return;
    const updated = { ...outputArtifacts };
    delete updated[key];
    removeArtifactMutation.mutate(updated);
  }

  function handleTemplateChange(roleName: string, templateId: string) {
    if (!issue || !currentStage) return;
    templateMutation.mutate({ roleName, templateId });
  }

  return (
    <div className="flex flex-col gap-[var(--space-sm)] p-[var(--space-md)]">
      {/* Issue Context */}
      <section className="bg-[var(--color-bg-elevated)] rounded-[var(--radius-md)] overflow-hidden" id="repo-context-summary-section">
        <div className="flex items-center justify-between px-[var(--space-md)] py-[var(--space-sm)] border-b border-[var(--color-border-muted)]">
          <div className="text-xs font-semibold text-[var(--color-text-primary)]">Issue Context</div>
        </div>
        <div className="p-[var(--space-md)]">
          <div className="flex items-center justify-between py-[var(--space-xs)] text-[var(--font-size-xs)]">
            <span className="text-[var(--color-text-muted)]">Workspace</span>
            <span className="text-[var(--color-text-primary)]">{workspace?.name || "未选择"}</span>
          </div>
          <div className="flex items-center justify-between py-[var(--space-xs)] text-[var(--font-size-xs)]">
            <span className="text-[var(--color-text-muted)]">Issue</span>
            <span className="text-[var(--color-text-primary)] truncate ml-[var(--space-sm)]">{issue?.title || "未选择"}</span>
          </div>
          <div className="flex items-center justify-between py-[var(--space-xs)] text-[var(--font-size-xs)]">
            <span className="text-[var(--color-text-muted)]">Stage</span>
            <span className="text-[var(--color-text-primary)]">{currentStage?.stage_definition?.title || currentStage?.type || "无"}</span>
          </div>
          <div className="flex items-center justify-between py-[var(--space-xs)] text-[var(--font-size-xs)]">
            <span className="text-[var(--color-text-muted)]">Conversation</span>
            <span className="text-[var(--color-text-primary)] truncate ml-[var(--space-sm)]">{currentConversation?.title || "未选择"}</span>
          </div>
          <div className="flex items-center justify-between py-[var(--space-xs)] text-[var(--font-size-xs)]">
            <span className="text-[var(--color-text-muted)]">WebSocket</span>
            <span className={wsStatus === "connected" ? "text-[var(--color-accent-cyan)]" : "text-[var(--color-text-grey)]"}>
              {wsStatus === "connected" ? "● 已连接" : wsStatus === "reconnecting" ? "● 重连中" : "○ 已断开"}
            </span>
          </div>
        </div>
      </section>

      {/* 当前推进 */}
      {currentStage && (
        <section className="bg-[var(--color-bg-elevated)] rounded-[var(--radius-md)] overflow-hidden">
          <div className="flex items-center justify-between px-[var(--space-md)] py-[var(--space-sm)] border-b border-[var(--color-border-muted)]">
            <div className="text-xs font-semibold text-[var(--color-text-primary)]">当前推进</div>
          </div>
          <div className="p-[var(--space-md)]">
            <div className="flex items-center justify-between py-[var(--space-xs)] text-[var(--font-size-xs)]">
              <span className="text-[var(--color-text-muted)]">阶段</span>
              <span className="text-[var(--color-text-primary)]">{currentStage.stage_definition?.title || currentStage.type}</span>
            </div>
            <div className="flex items-center justify-between py-[var(--space-xs)] text-[var(--font-size-xs)]">
              <span className="text-[var(--color-text-muted)]">状态</span>
              <span className={`inline-flex items-center px-[var(--space-xs)] py-px rounded-[var(--radius-sm)] text-[10px] font-medium ${
                currentStage.status === "in_progress"
                  ? "bg-[rgba(108,141,250,0.12)] text-[var(--color-accent)]"
                  : "bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]"
              }`}>
                {currentStage.status}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* 参与者 */}
      {participants.length > 0 && (
        <section className="bg-[var(--color-bg-elevated)] rounded-[var(--radius-md)] overflow-hidden">
          <div className="flex items-center justify-between px-[var(--space-md)] py-[var(--space-sm)] border-b border-[var(--color-border-muted)]">
            <div className="text-xs font-semibold text-[var(--color-text-primary)]">谁在执行</div>
          </div>
          <div className="p-[var(--space-md)] flex flex-col gap-[var(--space-sm)]">
            {participants.map((p) => (
              <div key={p.name} className="p-[var(--space-sm)] bg-[var(--color-bg-deep)] rounded-[var(--radius-sm)]" title={p.roleDef?.description || ""}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-[var(--space-xs)] text-[var(--font-size-sm)] text-[var(--color-text-primary)]">
                      {p.name}
                      {p.isPrimary && <span className="text-[9px] px-1 py-px rounded-[3px] bg-[rgba(108,141,250,0.12)] text-[var(--color-accent)]">主响应</span>}
                    </div>
                    <div className="text-[10px] text-[var(--color-text-grey)]">
                      {p.name === "项目负责人" ? "用户" : "协作角色"}
                    </div>
                  </div>
                  {p.roleDef?.snail_template_id && p.name !== "项目负责人" && templates.length > 0 && (
                    <select
                      className="text-[10px] px-[var(--space-xs)] py-px rounded-[var(--radius-sm)] bg-[var(--color-bg-input)] border border-[var(--color-border-muted)] text-[var(--color-text-primary)]"
                      value={p.roleDef.snail_template_id}
                      onChange={(e) => handleTemplateChange(p.name, e.target.value)}
                    >
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                <p className="text-[var(--font-size-xs)] text-[var(--color-text-muted)] mt-1">
                  {p.roleDef?.description || "暂无职责说明"}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 输出产物 */}
      {currentStage && (
        <section className="bg-[var(--color-bg-elevated)] rounded-[var(--radius-md)] overflow-hidden">
          <div className="flex items-center justify-between px-[var(--space-md)] py-[var(--space-sm)] border-b border-[var(--color-border-muted)]">
            <div className="text-xs font-semibold text-[var(--color-text-primary)]">输出产物</div>
            <span className="text-[var(--font-size-xs)] text-[var(--color-text-grey)]">
              {Object.keys(outputArtifacts).length}
            </span>
          </div>
          <div className="p-[var(--space-md)]">
            {Object.entries(outputArtifacts).map(([key, value]) => (
              <div key={key} className="flex items-center gap-[var(--space-xs)] py-[var(--space-xs)] px-[var(--space-sm)] mb-[var(--space-xs)] bg-[rgba(108,141,250,0.06)] rounded-[var(--radius-sm)] text-[var(--font-size-xs)]">
                <span className="font-semibold text-[var(--color-accent)]">{key}</span>
                <span className="flex-1 text-[var(--color-text-secondary)] truncate">{value}</span>
                <button
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-danger-text)] text-sm leading-none"
                  onClick={() => handleRemoveArtifact(key)}
                  aria-label="移除"
                >
                  ×
                </button>
              </div>
            ))}
            <div className="flex gap-[var(--space-xs)] mt-[var(--space-sm)]">
              <input
                type="text"
                className="flex-1 min-w-0 text-[var(--font-size-xs)] px-[var(--space-sm)] py-[var(--space-xs)] bg-[var(--color-bg-input)] border border-[var(--color-border-muted)] rounded-[var(--radius-sm)] text-[var(--color-text-primary)]"
                placeholder="键"
                value={newArtifactKey}
                onChange={(e) => setNewArtifactKey(e.target.value)}
              />
              <input
                type="text"
                className="flex-1 min-w-0 text-[var(--font-size-xs)] px-[var(--space-sm)] py-[var(--space-xs)] bg-[var(--color-bg-input)] border border-[var(--color-border-muted)] rounded-[var(--radius-sm)] text-[var(--color-text-primary)]"
                placeholder="值"
                value={newArtifactValue}
                onChange={(e) => setNewArtifactValue(e.target.value)}
              />
              <button className="shrink-0 text-[var(--font-size-xs)] px-[var(--space-sm)] py-[var(--space-xs)] bg-[var(--color-accent)] text-[var(--color-background)] rounded-[var(--radius-sm)] font-medium" onClick={handleAddArtifact}>添加</button>
            </div>
          </div>
        </section>
      )}

      {/* 输入产物 */}
      {Object.keys(inputArtifacts).length > 0 && (
        <section className="bg-[var(--color-bg-elevated)] rounded-[var(--radius-md)] overflow-hidden">
          <div className="flex items-center justify-between px-[var(--space-md)] py-[var(--space-sm)] border-b border-[var(--color-border-muted)]">
            <div className="text-xs font-semibold text-[var(--color-text-primary)]">输入产物</div>
            <span className="text-[var(--font-size-xs)] text-[var(--color-text-grey)]">
              {Object.keys(inputArtifacts).length}
            </span>
          </div>
          <div className="p-[var(--space-md)]">
            {Object.entries(inputArtifacts).map(([key, value]) => (
              <div key={key} className="flex items-center gap-[var(--space-xs)] py-[var(--space-xs)] px-[var(--space-sm)] mb-[var(--space-xs)] bg-[rgba(52,211,153,0.06)] rounded-[var(--radius-sm)] text-[var(--font-size-xs)]">
                <span className="font-semibold text-[var(--color-accent-cyan)]">{key}</span>
                <span className="flex-1 text-[var(--color-text-secondary)] truncate">{value}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
