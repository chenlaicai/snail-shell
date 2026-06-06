import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { api } from "../services/api-client";
import { useWebSocket } from "../hooks/useWebSocket";
import { ConversationView } from "./ConversationView";
import { BossMentionsBanner } from "../components/BossMentionsBanner";
import { StageActions, type Transition } from "../components/StageActions";
import { StageSuggestionBanner } from "../components/StageSuggestionBanner";
import { showToast } from "../components/Toast";
import { Button } from "@/components/ui/button";
import type { IssueDetailDto, StageDetailDto, ConversationDetailDto } from "../types";

export function ConversationLayout() {
  const { workspaceId, issueId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [issue, setIssue] = useState<IssueDetailDto | null>(null);
  const [currentStage, setCurrentStage] = useState<StageDetailDto | null>(null);
  const [currentConversation, setCurrentConversation] = useState<ConversationDetailDto | null>(null);
  const [conversations, setConversations] = useState<ConversationDetailDto[]>([]);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [loading, setLoading] = useState(true);

  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  // Load issue data
  const prevIssueRef = useRef<string | null>(null);
  useEffect(() => {
    if (!issueId) return;
    if (prevIssueRef.current !== issueId) {
      setCurrentStage(null);
      setCurrentConversation(null);
      prevIssueRef.current = issueId;
    }
    setLoading(true);
    api("GET /api/issues/:issueId", { params: { issueId } })
      .then((data) => {
        setIssue(data);
        const stageId = searchParamsRef.current.get("stage");
        const stage = stageId
          ? data.stages.find((s) => s.id === stageId)
          : data.current_stage || data.stages[data.stages.length - 1];
        setCurrentStage(stage || null);
        if (data.adopted_sop_id) {
          api("GET /api/sops/:sopId", { params: { sopId: data.adopted_sop_id } })
            .then((sop) => setTransitions(sop?.transitions ?? []))
            .catch(() => {});
        }
      })
      .catch((err) => showToast(`加载 Issue 失败：${err.message}`, true))
      .finally(() => setLoading(false));
  }, [issueId]);

  // Load conversations when stage changes
  useEffect(() => {
    if (!currentStage) return;
    api("GET /api/stages/:stageId/conversations", { params: { stageId: currentStage.id } })
      .then((data) => {
        setConversations(data);
        const convId = searchParamsRef.current.get("conv");
        const conv = convId ? data.find((c) => c.id === convId) : data[0];
        setCurrentConversation(conv || null);
      })
      .catch((err) => showToast(`加载 Conversation 失败：${err.message}`, true));
  }, [currentStage?.id]);

  // Update URL when stage/conversation changes
  useEffect(() => {
    if (!currentStage && !currentConversation) return;
    const params = new URLSearchParams();
    if (currentStage) params.set("stage", currentStage.id);
    if (currentConversation) params.set("conv", currentConversation.id);
    setSearchParams(params, { replace: true });
  }, [currentStage?.id, currentConversation?.id]);

  // WebSocket connection
  useWebSocket(currentConversation?.id || null);

  if (loading) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">加载中...</div>;
  if (!issue) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">Issue 不存在</div>;

  return (
    <div className="flex flex-col h-full min-h-0" data-view-pane="workspaces">
      <div className="top-workspace-state" />
      <div className="conv-header">
        <button className="conv-back" type="button" onClick={() => navigate(`/ws/${workspaceId}`)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="conv-title-area">
          <div className="conv-title">{issue.title}</div>
          <div className="conv-breadcrumb">
            {workspaceId} / <span>{issue.title}</span>
            {currentStage && ` / ${currentStage.stage_definition?.title || currentStage.type}`}
          </div>
        </div>
      </div>

      <div className="flex gap-2 p-2 px-6 border-b border-[var(--color-border-muted)] [&_.secondary-button]:text-[11px]">
        {issue.stages.map((stage) => (
          <button
            key={stage.id}
            className={`secondary-button${currentStage?.id === stage.id ? " active" : ""}`}
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
        onStageChanged={() => {
          if (!issueId) return;
          api("GET /api/issues/:issueId", { params: { issueId } }).then((data) => {
            setIssue(data);
            const stage = data.stages[data.stages.length - 1];
            setCurrentStage(stage || null);
          });
        }}
      />

      {conversations.length > 1 && (
        <div className="flex gap-2 py-1 px-6 border-b border-[var(--color-border-muted)]">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              className={`ghost-button${currentConversation?.id === conv.id ? " active" : ""}`}
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
                const result = await api("POST /api/issues/:issueId/stages/:stageId/conversations", {
                  params: { issueId, stageId: currentStage.id },
                  body: { workspace_id: workspaceId || "", title: `Conversation ${conversations.length + 1}`, kind: "discussion" },
                });
                setConversations((prev) => [...prev, result]);
                setCurrentConversation(result);
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

      <StageSuggestionBanner issueId={issueId || null} onAccepted={() => {
        if (!issueId) return;
        api("GET /api/issues/:issueId", { params: { issueId } }).then((data) => {
          setIssue(data);
          const stage = data.stages[data.stages.length - 1];
          setCurrentStage(stage || null);
        });
      }} />
      <BossMentionsBanner conversationId={currentConversation?.id || null} />
      <ConversationView conversationId={currentConversation?.id || null} />
    </div>
  );
}
