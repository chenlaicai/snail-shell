import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { api } from "../services/api-client";
import { useWebSocket } from "../hooks/useWebSocket";
import { useConversationStore } from "../stores/conversationStore";
import { ConversationView } from "./ConversationView";
import { BossMentionsBanner } from "../components/BossMentionsBanner";
import { StageActions, type Transition } from "../components/StageActions";
import { StageSuggestionBanner } from "../components/StageSuggestionBanner";
import { showToast } from "../components/Toast";
import { Button } from "@/components/ui/button";

interface Stage {
  id: string;
  type: string;
  status: string;
  stage_definition?: { title?: string };
}

interface Conversation {
  id: string;
  title: string;
  default_role: string;
}

interface Issue {
  id: string;
  title: string;
  stages: Stage[];
  current_stage?: Stage;
  sop_snapshot?: { sop_id?: string };
  closed_at?: string | null;
}

export function ConversationLayout() {
  const { workspaceId, issueId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [loading, setLoading] = useState(true);

  const { currentStage, currentConversation, setCurrentStage, setCurrentConversation, clear } =
    useConversationStore();

  // Use ref to avoid stale closure in effects
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  // Load issue data — 只在 issueId 变化时清空并重新加载
  const prevIssueRef = useRef<string | null>(null);
  useEffect(() => {
    if (!issueId) return;
    // 只在切换到不同 issue 时才清空
    if (prevIssueRef.current !== issueId) {
      clear();
      prevIssueRef.current = issueId;
    }
    setLoading(true);
    api("GET /api/issues/:issueId", { params: { issueId: issueId! } })
      .then((data: Issue) => {
        setIssue(data);
        const stageId = searchParamsRef.current.get("stage");
        const stage = stageId
          ? data.stages.find((s) => s.id === stageId)
          : data.current_stage || data.stages[data.stages.length - 1];
        setCurrentStage(stage || null);
        if (data.sop_snapshot?.sop_id) {
          api("GET /api/sops/:sopId", { params: { sopId: data.sop_snapshot.sop_id } })
            .then((sop: { transitions?: Transition[] }) => setTransitions(sop?.transitions ?? []))
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
      .then((data: Conversation[]) => {
        setConversations(data);
        const convId = searchParamsRef.current.get("conv");
        const conv = convId ? data.find((c) => c.id === convId) : data[0];
        setCurrentConversation(conv || null);
      })
      .catch((err) => showToast(`加载 Conversation 失败：${err.message}`, true));
  }, [currentStage?.id]);

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

  if (loading) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">加载中...</div>;
  if (!issue) return <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]">Issue 不存在</div>;

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
        onStageChanged={() => {
          api("GET /api/issues/:issueId", { params: { issueId: issueId! } }).then((data: Issue) => {
            setIssue(data);
            const stage = data.stages[data.stages.length - 1];
            setCurrentStage(stage || null);
          });
        }}
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
                setConversations((prev) => [...prev, newConv]);
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

      <StageSuggestionBanner issueId={issueId || null} onAccepted={() => {
        api("GET /api/issues/:issueId", { params: { issueId: issueId! } }).then((data: Issue) => {
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
