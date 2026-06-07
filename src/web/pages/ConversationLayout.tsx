import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { issueQueries } from "../queries/workspace.queries";
import { sopQueries } from "../queries/sop.queries";
import { queryKeys } from "../queries/keys";
import { useWebSocket } from "../hooks/useWebSocket";
import { useConversationStore } from "../stores/conversationStore";
import { ConversationView } from "./ConversationView";
import { BossMentionsBanner } from "../components/BossMentionsBanner";
import { StageActions } from "../components/StageActions";
import { StageSuggestionBanner } from "../components/StageSuggestionBanner";
import { showToast } from "../components/Toast";
import { Button } from "@/components/ui/button";
export function ConversationLayout() {
  const { workspaceId, issueId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const { currentStage, currentConversation, setCurrentStage, setCurrentConversation, clear } =
    useConversationStore();

  // TanStack Query: issue detail
  const { data: issue, isLoading } = useQuery({
    ...issueQueries.detail(issueId || ""),
    enabled: !!issueId,
  });

  // TanStack Query: SOP transitions
  const sopId = issue?.sop_snapshot?.sop_id;
  const { data: transitions = [] } = useQuery({
    ...sopQueries.detail(sopId || ""),
    enabled: !!sopId,
    select: (data) => data.transitions,
  });

  // 当前 stage 的 ID（来自 store 或 issue 默认值）
  const activeStageId = currentStage?.id || issue?.current_stage?.id || issue?.stages?.at(-1)?.id;

  // TanStack Query: stage conversations
  const { data: conversations = [] } = useQuery({
    ...issueQueries.stageConversations(activeStageId || ""),
    enabled: !!activeStageId,
  });

  // 初始化：issueId 切换时清空 store 并设置默认 stage/conv
  // 用单一 key 跟踪初始化状态，避免双 ref 隐式依赖
  const initKey = issueId ? `${issueId}:${activeStageId ?? ""}` : null;
  const lastInitRef = useRef<string | null>(null);

  useEffect(() => {
    if (!issueId || !issue || !initKey) return;
    if (lastInitRef.current === initKey) return;
    lastInitRef.current = initKey;

    // issueId 变化时清空
    const prevIssue = lastInitRef.current?.split(":")[0];
    if (prevIssue !== issueId) clear();

    // 设置 stage（仅尚未设置时）
    if (!currentStage) {
      const stageId = searchParams.get("stage");
      const stage = stageId
        ? issue.stages.find((s) => s.id === stageId)
        : issue.current_stage || issue.stages[issue.stages.length - 1];
      setCurrentStage(stage || null);
    }

    // 设置 conversation（仅 conversations 已加载且尚未设置时）
    if (!currentConversation && conversations.length) {
      const convId = searchParams.get("conv");
      const conv = convId ? conversations.find((c) => c.id === convId) : conversations[0];
      setCurrentConversation(conv || null);
    }
  }, [initKey]);

  // Update URL when stage/conversation changes (one-way: store -> URL)
  useEffect(() => {
    if (!currentStage && !currentConversation) return;
    const params = new URLSearchParams();
    if (currentStage) params.set("stage", currentStage.id);
    if (currentConversation) params.set("conv", currentConversation.id);
    setSearchParams(params, { replace: true });
  }, [currentStage?.id, currentConversation?.id]);

  // WebSocket connection
  useWebSocket(currentConversation?.id || null);

  if (isLoading) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">加载中...</div>;
  if (!issue) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">Issue 不存在</div>;

  function handleStageChanged() {
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId!) });
    if (currentStage) {
      queryClient.invalidateQueries({ queryKey: queryKeys.stages.conversations(currentStage.id) });
    }
    // 重置 store 和初始化跟踪，使 effect 重新设置 stage/conv
    setCurrentStage(null);
    setCurrentConversation(null);
    lastInitRef.current = null;
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" data-view-pane="workspaces">
      {/* Header */}
      <div className="flex items-center gap-[var(--space-md)] px-[var(--space-lg)] py-[var(--space-sm)] border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
        <button className="p-[var(--space-xs)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]" type="button" onClick={() => navigate(`/ws/${workspaceId}`)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{issue.title}</div>
          <div className="text-[11px] text-[var(--color-text-grey)] truncate">
            {workspaceId} / <span>{issue.title}</span>
            {currentStage && ` / ${currentStage.stage_definition?.title || currentStage.type}`}
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
            {stage.stage_definition?.title || stage.type}
          </button>
        ))}
      </div>

      <StageActions
        issue={issue}
        currentStage={currentStage}
        transitions={transitions}
        onStageChanged={handleStageChanged}
      />

      {/* Conversation tabs */}
      {conversations.length > 1 && (
        <div className="flex gap-[var(--space-xs)] px-[var(--space-lg)] py-[var(--space-xs)] border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0 overflow-x-auto">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              className={`px-[var(--space-md)] py-[var(--space-xs)] rounded-[var(--radius-sm)] text-[11px] transition-colors ${
                currentConversation?.id === conv.id
                  ? "bg-[var(--color-bg-active)] text-[var(--color-accent)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)]"
              }`}
              onClick={() => setCurrentConversation(conv)}
            >
              {conv.title}
            </button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              if (!issueId || !currentStage) return;
              try {
                const result = await api("POST /api/issues/:issueId/stages/:stageId/conversations", { params: { issueId: issueId!, stageId: currentStage.id }, body: {} });
                const newConv = result.conversation || result;
                queryClient.invalidateQueries({ queryKey: queryKeys.stages.conversations(currentStage.id) });
                setCurrentConversation(newConv);
                showToast("已创建新 Conversation");
              } catch (err: unknown) {
                showToast(`创建失败：${err instanceof Error ? err.message : String(err)}`, true);
              }
            }}
          >
            + 新建
          </Button>
        </div>
      )}

      <StageSuggestionBanner issueId={issueId || null} onAccepted={handleStageChanged} />
      <BossMentionsBanner conversationId={currentConversation?.id || null} />
      <ConversationView conversationId={currentConversation?.id || null} />
    </div>
  );
}
