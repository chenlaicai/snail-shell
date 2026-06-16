import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConversationStore } from "../stores/conversationStore";
import { api } from "../services/api-client";
import { metaQueries } from "../queries/meta.queries";
import { queryKeys } from "../queries/keys";
import type { WorkspaceSummaryDto, IssueDto, Participant, StageDetailDto, RoleSnailAssignment } from "../types";

export function ContextPanel({
  workspace,
  issue,
}: {
  workspace: WorkspaceSummaryDto | null;
  issue: IssueDto | null;
}) {
  const { currentStage, wsStatus } = useConversationStore();

  const { data: stageDetail } = useQuery({
    queryKey: queryKeys.stages.detail(currentStage?.id ?? ""),
    queryFn: (): Promise<StageDetailDto> => api("GET /api/stages/:stageId", { params: { stageId: currentStage!.id } }),
    enabled: !!currentStage?.id,
  });

  const { data: templates = [] } = useQuery(metaQueries.snailDen());

  const participants = useMemo((): Participant[] => {
    const stage = stageDetail ?? currentStage;
    if (!stage) return [];

    const assignments = (stage.assignments ?? []) as RoleSnailAssignment[];
    if (assignments.length > 0) {
      return assignments.map((assignment) => ({
        name: assignment.role_instance,
        roleDef: {
          name: assignment.role_key,
          description: assignment.description,
          snail_template_id: assignment.snail_key,
        },
        isPrimary: assignment.role_instance === stage.default_role_instance,
      }));
    }

    const roleNames = stage.active_roles || stage.role_instances || [];
    return roleNames.map((name: string) => ({
      name,
      roleDef: null,
      isPrimary: name === stage.default_role_instance,
    }));
  }, [currentStage, stageDetail]);

  const toStringRecord = (r: Record<string, unknown> | undefined): Record<string, string> => {
    if (!r) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) out[k] = String(v ?? "");
    return out;
  };
  const outputArtifacts = useMemo(() => toStringRecord(stageDetail?.output_artifacts), [stageDetail?.output_artifacts]);
  const inputArtifacts = useMemo(() => toStringRecord(stageDetail?.input_artifacts), [stageDetail?.input_artifacts]);

  const stage = stageDetail ?? currentStage;
  const stageTitle = stage?.title || stage?.key || "无";
  const stageDescription = stage?.description || "暂无阶段说明";

  return (
    <aside className="flex flex-col gap-4 px-4 py-4 text-[12px]">
      <PanelSection title="Details">
        <div className="space-y-2">
          <DetailRow label="Workspace" value={workspace?.summary || workspace?.path || "未选择"} />
          <DetailRow label="Issue" value={issue?.title || "未选择"} />
          <DetailRow label="Stage" value={stageTitle} />
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-text-muted">WebSocket</span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              wsStatus === "connected"
                ? "bg-status-green/10 text-status-green"
                : "bg-status-amber/10 text-status-amber"
            }`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {wsStatus === "connected" ? "Connected" : wsStatus === "reconnecting" ? "Reconnecting" : "Disconnected"}
            </span>
          </div>
        </div>
      </PanelSection>

      <Divider />

      {stage && (
        <PanelSection title="Current Stage">
          <div className="rounded-lg border border-white/6 bg-surface-2 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0 truncate text-[13px] font-medium text-text-primary">{stageTitle}</div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                stage.status === "in_progress"
                  ? "bg-shell-600/15 text-shell-400"
                  : "bg-surface-3 text-text-muted"
              }`}>
                {stage.status}
              </span>
            </div>
            <p className="text-[12px] leading-relaxed text-text-muted">{stageDescription}</p>
          </div>
        </PanelSection>
      )}

      {stage && <Divider />}

      {participants.length > 0 && (
        <PanelSection title="Agents">
          <div className="space-y-2">
            {participants.map((p) => (
              <div key={p.name} className="rounded-lg border border-white/6 bg-surface-2 p-3" title={p.roleDef?.description || ""}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-shell-500 to-shell-700 text-[10px] font-semibold text-white">
                      {p.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 truncate text-[12px] font-medium text-text-primary">{p.name}</div>
                  </div>
                  {p.isPrimary && <span className="shrink-0 rounded-full bg-shell-600/15 px-2 py-0.5 text-[9px] text-shell-400">主响应</span>}
                </div>
                <div className="text-[10px] text-text-grey">
                  {p.roleDef?.name ? `role: ${p.roleDef.name}` : "协作角色"}
                </div>
                {p.roleDef?.snail_template_id && p.name !== "项目负责人" && (
                  <div className="mt-2 inline-flex max-w-full rounded-md border border-white/6 bg-surface-3 px-2 py-0.5 text-[10px] text-text-muted">
                    <span className="truncate">{templates.find((t) => t.key === p.roleDef?.snail_template_id)?.name || p.roleDef.snail_template_id}</span>
                  </div>
                )}
                <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
                  {p.roleDef?.description || "暂无职责说明"}
                </p>
              </div>
            ))}
          </div>
        </PanelSection>
      )}

      {participants.length > 0 && <Divider />}

      {stage && (
        <PanelSection title="Artifacts">
          <ArtifactList title="Output" artifacts={outputArtifacts} color="blue" />
          {Object.keys(inputArtifacts).length > 0 && <ArtifactList title="Input" artifacts={inputArtifacts} color="green" />}
          {Object.keys(outputArtifacts).length === 0 && Object.keys(inputArtifacts).length === 0 && (
            <div className="rounded-lg border border-dashed border-white/6 bg-surface-2 p-3 text-[12px] text-text-muted">
              暂无产物
            </div>
          )}
        </PanelSection>
      )}
    </aside>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-text-muted">{title}</div>
      {children}
    </section>
  );
}

function Divider() {
  return <div className="h-px bg-white/6" />;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="shrink-0 text-text-muted">{label}</span>
      <span className="min-w-0 truncate text-right text-text-primary">{value}</span>
    </div>
  );
}

function ArtifactList({ title, artifacts, color }: { title: string; artifacts: Record<string, string>; color: "blue" | "green" }) {
  const entries = Object.entries(artifacts);
  if (entries.length === 0) return null;
  const accent = color === "blue" ? "text-shell-400" : "text-status-green";

  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-text-grey">{title}</div>
      <div className="space-y-1.5">
        {entries.map(([key, value]) => (
          <div key={key} className="rounded-md border border-white/6 bg-surface-2 px-2 py-1.5 text-[11px]">
            <div className={`font-semibold ${accent}`}>{key}</div>
            <div className="mt-0.5 truncate text-text-secondary">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
