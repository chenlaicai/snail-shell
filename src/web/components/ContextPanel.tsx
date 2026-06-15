import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConversationStore } from "../stores/conversationStore";
import { api } from "../services/api-client";
import { metaQueries } from "../queries/meta.queries";
import { queryKeys } from "../queries/keys";
import type { WorkspaceSummaryDto, IssueDto, Participant, RoleDefinition, StageDetailDto } from "../types";

export function ContextPanel({
  workspace,
  issue,
}: {
  workspace: WorkspaceSummaryDto | null;
  issue: IssueDto | null;
}) {
  const { currentStage, wsStatus } = useConversationStore();

  // TanStack Query: stage detail
  const { data: stageDetail } = useQuery({
    queryKey: queryKeys.stages.detail(currentStage?.id ?? ""),
    queryFn: (): Promise<StageDetailDto> => api("GET /api/stages/:stageId", { params: { stageId: currentStage!.id } }),
    enabled: !!currentStage?.id,
  });

  // TanStack Query: templates
  const { data: templates = [] } = useQuery(metaQueries.snailDen());

  // 从 stageDetail 角色实例计算参与者列表
  const participants = useMemo((): Participant[] => {
    if (!stageDetail) return [];
    const roleDefs = stageDetail.stage_definition?.roles || [];
    const roleNames = stageDetail.active_roles || stageDetail.role_instances || [];
    const participantMap = new Map<string, Participant>();
    roleDefs.forEach((roleDef: RoleDefinition) => {
      participantMap.set(roleDef.name, { name: roleDef.name, roleDef, isPrimary: roleDef.is_primary || false });
    });
    roleNames.forEach((name: string) => {
      if (!participantMap.has(name)) {
        participantMap.set(name, { name, roleDef: null, isPrimary: name === stageDetail.default_role_instance });
      }
    });
    return Array.from(participantMap.values());
  }, [stageDetail]);

  /** 将 Record<string, unknown> 安全转为 Record<string, string>，避免 as 断言 */
  const toStringRecord = (r: Record<string, unknown> | undefined): Record<string, string> => {
    if (!r) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) out[k] = String(v ?? "");
    return out;
  };
  const outputArtifacts = useMemo(() => toStringRecord(stageDetail?.output_artifacts), [stageDetail?.output_artifacts]);
  const inputArtifacts = useMemo(() => toStringRecord(stageDetail?.input_artifacts), [stageDetail?.input_artifacts]);

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
                  {p.roleDef?.snail_template_id && p.name !== "项目负责人" && (
                    <span className="text-[10px] px-[var(--space-xs)] py-px rounded-[var(--radius-sm)] bg-[var(--color-bg-input)] border border-[var(--color-border-muted)] text-[var(--color-text-muted)]">
                      {templates.find((t) => t.id === p.roleDef?.snail_template_id)?.name || p.roleDef.snail_template_id}
                    </span>
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
              </div>
            ))}
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
