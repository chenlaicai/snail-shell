import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import { useWebSocket } from "../hooks/useWebSocket";
import { useConversationStore } from "../stores/conversationStore";
import { ConversationView } from "./ConversationView";
import { BossMentionsBanner } from "../components/BossMentionsBanner";
import { StageActions } from "../components/StageActions";
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
  adopted_sop_id?: string;
  closed_at?: string | null;
}

export function ConversationLayout() {
  const { workspaceId, issueId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [transitions, setTransitions] = useState<{ from_stage_key: string; to_stage_key: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const { currentStage, currentConversation, setCurrentStage, setCurrentConversation, clear } =
    useConversationStore();

  // Use ref to avoid stale closure in effects
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  // Load issue data
  useEffect(() => {
    if (!issueId) return;
    clear();
    setLoading(true);
    api("GET", `/issues/${issueId}`)
      .then((data: Issue) => {
        setIssue(data);
        const stageId = searchParamsRef.current.get("stage");
        const stage = stageId
          ? data.stages.find((s) => s.id === stageId)
          : data.current_stage || data.stages[data.stages.length - 1];
        setCurrentStage(stage || null);
        if (data.adopted_sop_id) {
          api("GET", `/sops/${data.adopted_sop_id}`)
            .then((sop: any) => setTransitions(sop?.transitions ?? []))
            .catch(() => {});
        }
      })
      .catch((err) => showToast(`加载 Issue 失败：${err.message}`, true))
      .finally(() => setLoading(false));
  }, [issueId]);

  // Load conversations when stage changes
  useEffect(() => {
    if (!currentStage) return;
    api("GET", `/stages/${currentStage.id}/conversations`)
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

  if (loading) return <div className="task-board-empty">加载中...</div>;
  if (!issue) return <div className="task-board-empty">Issue 不存在</div>;

  return (
    <div className="workspace-main view-pane is-active" data-view-pane="workspaces">
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

      <div className="conv-stage-tabs">
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
          api("GET", `/issues/${issueId}`).then((data: Issue) => {
            setIssue(data);
            const stage = data.stages[data.stages.length - 1];
            setCurrentStage(stage || null);
          });
        }}
      />

      {conversations.length > 1 && (
        <div className="conv-conv-tabs">
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
                const result = await api("POST", `/issues/${issueId}/stages/${currentStage.id}/conversations`, {});
                const newConv = result.conversation || result;
                setConversations((prev) => [...prev, newConv]);
                setCurrentConversation(newConv);
                showToast("已创建新 Conversation");
              } catch (err: any) {
                showToast(`创建失败：${err.message}`, true);
              }
            }}
          >
            + 新建
          </Button>
        </div>
      )}

      <StageSuggestionBanner issueId={issueId || null} onAccepted={() => {
        api("GET", `/issues/${issueId}`).then((data: any) => {
          setIssue(data);
          const stage = data.stages[data.stages.length - 1];
          setCurrentStage(stage || null);
        });
      }} />
      <BossMentionsBanner conversationId={currentConversation?.id || null} />
      <ConversationView />
    </div>
  );
}
