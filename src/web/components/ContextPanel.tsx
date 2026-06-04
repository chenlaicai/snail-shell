import { useConversationStore } from "../stores/conversationStore";

interface Workspace {
  id: string;
  name: string;
  kind?: string;
  boss_pending_count?: number;
}

interface Issue {
  id: string;
  title: string;
  closed_at?: string | null;
}

export function ContextPanel({
  workspace,
  issue,
}: {
  workspace: Workspace | null;
  issue: Issue | null;
}) {
  const { currentStage, currentConversation, wsStatus } = useConversationStore();

  return (
    <div className="context-rail">
      <section className="context-card" id="repo-context-summary-section">
        <div className="repo-context-summary-header">
          <div className="context-card-title">Issue Context</div>
        </div>
        <div className="repo-context-card repo-context-card-inline">
          <div className="context-line">
            <span>Workspace</span>
            <span>{workspace?.name || "未选择"}</span>
          </div>
          <div className="context-line">
            <span>Issue</span>
            <span>{issue?.title || "未选择"}</span>
          </div>
          <div className="context-line">
            <span>Stage</span>
            <span>{currentStage?.stage_definition?.title || currentStage?.type || "无"}</span>
          </div>
          <div className="context-line">
            <span>Conversation</span>
            <span>{currentConversation?.title || "未选择"}</span>
          </div>
          <div className="context-line">
            <span>WebSocket</span>
            <span style={{ color: wsStatus === "connected" ? "var(--color-accent-cyan)" : "var(--color-text-grey)" }}>
              {wsStatus === "connected" ? "● 已连接" : wsStatus === "reconnecting" ? "● 重连中" : "○ 已断开"}
            </span>
          </div>
        </div>
      </section>

      {currentStage && (
        <section className="context-card workspace-progress-card">
          <div className="context-card-header">
            <div className="context-card-title">当前推进</div>
          </div>
          <div style={{ padding: "var(--space-md)" }}>
            <div className="context-line">
              <span>阶段</span>
              <span>{currentStage.stage_definition?.title || currentStage.type}</span>
            </div>
            <div className="context-line">
              <span>状态</span>
              <span className={`chip ${currentStage.status === "in_progress" ? "hot" : ""}`}>
                {currentStage.status}
              </span>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
