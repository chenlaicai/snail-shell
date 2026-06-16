import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { issueQueries } from "../queries/workspace.queries";
import { sopQueries } from "../queries/sop.queries";
import { queryKeys } from "../queries/keys";
import { useIssueRealtime } from "../hooks/useWebSocket";
import { useConversationStore } from "../stores/conversationStore";
import { ConversationView } from "./ConversationView";
import { BossMentionsBanner } from "../components/BossMentionsBanner";
import { StageActions } from "../components/StageActions";
import { StageSuggestionBanner } from "../components/StageSuggestionBanner";
export function ConversationLayout() {
  const { workspaceId, issueId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const { currentStage, setCurrentStage, clear } = useConversationStore();

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

  // 初始化：issueId 切换时清空 store 并设置默认 stage
  const initKey = issueId ? `${issueId}:${issue?.stages?.map((stage) => stage.id).join(",") ?? ""}` : null;
  const lastInitRef = useRef<string | null>(null);

  useEffect(() => {
    if (!issueId || !issue || !initKey) return;
    const prevKey = lastInitRef.current;
    if (prevKey === initKey) return;
    lastInitRef.current = initKey;

    const prevIssue = prevKey?.split(":")[0];
    if (prevIssue !== issueId) clear();

    const stageId = searchParams.get("stage");
    const stage = stageId
      ? issue.stages.find((item) => item.id === stageId)
      : issue.current_stage || issue.stages.at(-1);
    setCurrentStage(stage || null);
  }, [initKey, issue, issueId, searchParams, clear, setCurrentStage]);

  // Update URL when stage changes (one-way: store -> URL)
  useEffect(() => {
    if (!currentStage) return;
    setSearchParams({ stage: currentStage.id }, { replace: true });
  }, [currentStage?.id, setSearchParams]);

  // Issue-scoped realtime connection
  useIssueRealtime(issueId || null);

  if (isLoading) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">加载中...</div>;
  if (!issue) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">Issue 不存在</div>;

  function handleStageChanged() {
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId!) });
    const latestStage = useConversationStore.getState().currentStage;
    if (latestStage) {
      queryClient.invalidateQueries({ queryKey: queryKeys.stages.messages(latestStage.id) });
    }
    setCurrentStage(null);
    lastInitRef.current = null;
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
          <div className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{issue.title}</div>
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
            onClick={() => setCurrentStage(stage)}
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
      <ConversationView stageId={currentStage?.id || null} />
    </div>
  );
}
