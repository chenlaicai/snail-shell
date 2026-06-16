import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { issueQueries } from "../queries/workspace.queries";
import { sopQueries } from "../queries/sop.queries";
import { queryKeys } from "../queries/keys";
import { useIssueRealtime } from "../hooks/useWebSocket";
import { useCurrentStage } from "../hooks/useCurrentStage";
import { useConversationStore } from "../stores/conversationStore";
import { ConversationView } from "./ConversationView";
import { BossMentionsBanner } from "../components/BossMentionsBanner";
import { StageActions } from "../components/StageActions";
import { StageSuggestionBanner } from "../components/StageSuggestionBanner";
import type { StageDetailDto } from "../types";
function IssueRealtimeBadge({ status }: { status: "connected" | "disconnected" | "reconnecting" }) {
  const isConnected = status === "connected";
  const label = status === "connected" ? "Realtime connected" : status === "reconnecting" ? "Realtime reconnecting" : "Realtime disconnected";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
      isConnected
        ? "border-status-green/20 bg-status-green/10 text-status-green"
        : "border-status-amber/20 bg-status-amber/10 text-status-amber"
    }`} title="Issue 级实时通道状态">
      <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? "bg-status-green" : "animate-pulse bg-status-amber"}`} />
      {label}
    </span>
  );
}

export function ConversationLayout() {
  const { workspaceId, issueId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentStage, selectedStageId, setSearchParams } = useCurrentStage(issue);

  const wsStatus = useConversationStore((state) => state.wsStatus);
  const clear = useConversationStore((state) => state.clear);

  // TanStack Query: issue detail
  const { data: issue, isLoading } = useQuery({
    ...issueQueries.detail(issueId || ""),
    enabled: !!issueId,
  });

  // TanStack Query: SOP transitions
  const sopId = issue?.sop_snapshot?.key;
  const { data: transitions = [] } = useQuery({
    ...sopQueries.detail(sopId || ""),
    enabled: !!sopId,
    select: (data) => data.transitions ?? [],
  });

  // issueId 切换时清空 issue-scoped 客户端状态；当前 stage 由 URL + issue detail 派生
  const lastIssueRef = useRef<string | null>(null);

  useEffect(() => {
    if (!issueId) return;
    if (lastIssueRef.current === issueId) return;
    clear();
    lastIssueRef.current = issueId;
  }, [issueId, clear]);

  useEffect(() => {
    if (!currentStage) return;
    if (selectedStageId === currentStage.id) return;
    setSearchParams({ stage: currentStage.id }, { replace: true });
  }, [currentStage?.id, selectedStageId, setSearchParams]);

  // Issue-scoped realtime connection
  useIssueRealtime(issueId || null, currentStage?.id ?? null);

  if (isLoading) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">加载中...</div>;
  if (!issue) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">Issue 不存在</div>;

  function handleStageChanged(stage: StageDetailDto) {
    queryClient.setQueryData(queryKeys.issues.detail(issueId!), (old: typeof issue | undefined) => old
      ? {
          ...old,
          current_stage: stage,
          stages: old.stages.some((item) => item.id === stage.id)
            ? old.stages.map((item) => item.id === stage.id ? stage : item)
            : [...old.stages.map((item) => item.left_at ? item : { ...item, left_at: new Date().toISOString(), status: "completed" as const }), stage],
        }
      : old
    );
    queryClient.invalidateQueries({ queryKey: queryKeys.stages.messages(stage.id) });
    setSearchParams({ stage: stage.id }, { replace: true });
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" data-view-pane="workspaces">
      {/* Header */}
      <div className="flex items-center gap-[var(--space-md)] px-[var(--space-lg)] py-[var(--space-sm)] border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
        <button className="p-[var(--space-xs)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]" type="button" onClick={() => navigate(`/workspaces/${workspaceId}`)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{issue.title}</div>
            <IssueRealtimeBadge status={wsStatus} />
          </div>
          <div className="text-[11px] text-[var(--color-text-grey)] truncate">
            {workspaceId} / <span>{issue.title}</span>
            {currentStage && ` / ${currentStage.stage_definition?.title || currentStage.title || currentStage.type}`}
          </div>
        </div>
      </div>

      {/* Stage tabs */}
      <div className="flex gap-[var(--space-xs)] px-[var(--space-lg)] py-[var(--space-sm)] border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0 overflow-x-auto">
        {issue.stages.map((stage) => (
          <button
            key={stage.id}
            className={`px-[var(--space-md)] py-[var(--space-xs)] rounded-[var(--radius-sm)] text-[12px] border transition-colors ${
              currentStage?.id === stage.id
                ? "border-[var(--color-accent)] bg-[rgba(108,141,250,0.08)] text-[var(--color-accent)]"
                : "border-[var(--color-border-muted)] text-[var(--color-text-muted)] hover:border-[var(--color-border-default)] hover:text-[var(--color-text-primary)]"
            }`}
            onClick={() => setSearchParams({ stage: stage.id }, { replace: true })}
          >
            {stage.stage_definition?.title || stage.title || stage.type}
          </button>
        ))}
      </div>

      <StageActions
        issue={issue}
        currentStage={currentStage}
        transitions={transitions}
        onStageChanged={handleStageChanged}
      />

      <StageSuggestionBanner stageId={currentStage?.id || null} onAccepted={handleStageChanged} />
      <BossMentionsBanner stageId={currentStage?.id || null} />
      <ConversationView stageId={currentStage?.id || null} stageStatus={currentStage?.status ?? null} />
    </div>
  );
}
