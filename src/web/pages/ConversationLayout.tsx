import { useParams, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "../services/api";
import { useWebSocket } from "../hooks/useWebSocket";
import { useConversationStore } from "../stores/conversationStore";
import { ConversationView } from "./ConversationView";
import { BossMentionsBanner } from "../components/BossMentionsBanner";
import { StageActions } from "../components/StageActions";

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
}

export function ConversationLayout() {
  const { workspaceId, issueId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [transitions, setTransitions] = useState<{ from_stage_key: string; to_stage_key: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const { currentStage, currentConversation, setCurrentStage, setCurrentConversation, clear } =
    useConversationStore();

  // Load issue data
  useEffect(() => {
    if (!issueId) return;
    clear();
    setLoading(true);
    api("GET", `/issues/${issueId}`)
      .then((data: Issue) => {
        setIssue(data);
        // Restore stage from URL or use current_stage
        const stageId = searchParams.get("stage");
        const stage = stageId
          ? data.stages.find((s) => s.id === stageId)
          : data.current_stage || data.stages[data.stages.length - 1];
        setCurrentStage(stage || null);
        // Load SOP transitions
        if (data.adopted_sop_id) {
          api("GET", `/sops/${data.adopted_sop_id}`)
            .then((sop: any) => setTransitions(sop?.transitions ?? []))
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [issueId]);

  // Load conversations when stage changes
  useEffect(() => {
    if (!currentStage) return;
    api("GET", `/stages/${currentStage.id}/conversations`)
      .then((data: Conversation[]) => {
        setConversations(data);
        // Restore conversation from URL or use first
        const convId = searchParams.get("conv");
        const conv = convId ? data.find((c) => c.id === convId) : data[0];
        setCurrentConversation(conv || null);
      })
      .catch(() => {});
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
        <button className="conv-back" type="button" onClick={() => window.history.back()}>
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

      {/* Stage tabs */}
      <div style={{ display: "flex", gap: 8, padding: "8px var(--space-xl)", borderBottom: "1px solid var(--color-border-muted)" }}>
        {issue.stages.map((stage) => (
          <button
            key={stage.id}
            className={`secondary-button${currentStage?.id === stage.id ? " active" : ""}`}
            onClick={() => setCurrentStage(stage)}
            style={{ fontSize: "var(--font-size-xs)" }}
          >
            {stage.stage_definition?.title || stage.type}
          </button>
        ))}
      </div>

      {/* Stage actions */}
      <StageActions
        issue={issue}
        currentStage={currentStage}
        transitions={transitions}
        onStageChanged={() => {
          // Reload issue data after stage change
          api("GET", `/issues/${issueId}`).then((data: Issue) => {
            setIssue(data);
            const stage = data.stages[data.stages.length - 1];
            setCurrentStage(stage || null);
          });
        }}
      />

      {/* Conversation tabs */}
      {conversations.length > 1 && (
        <div style={{ display: "flex", gap: 8, padding: "4px var(--space-xl)", borderBottom: "1px solid var(--color-border-muted)" }}>
          {conversations.map((conv) => (
            <button
              key={conv.id}
              className={`ghost-button${currentConversation?.id === conv.id ? " active" : ""}`}
              onClick={() => setCurrentConversation(conv)}
              style={{ fontSize: "var(--font-size-xs)" }}
            >
              {conv.title}
            </button>
          ))}
        </div>
      )}

      <BossMentionsBanner conversationId={currentConversation?.id || null} />
      <ConversationView />
    </div>
  );
}
