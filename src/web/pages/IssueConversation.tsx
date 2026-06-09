import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { issueQueries } from "@/queries/issue.queries";
import { conversationQueries } from "@/queries/conversation.queries";
import { useSendMessage, useInterruptMessage } from "@/mutations/conversation.mutations";
import { useAdvanceIssue, useCompleteIssue, useArchiveIssue, useConfirmStageSuggestion, useRejectStageSuggestion } from "@/mutations/issue.mutations";
import { useWebSocket } from "@/hooks/useWebSocket";
import { TopBar } from "@/components/TopBar";
import { StatusBadge } from "@/components/StatusBadge";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { PropertiesPanel } from "@/components/PropertiesPanel";
import { QueryState } from "@/components/QueryState";
import { ToolApprovalCard } from "@/components/ToolApprovalCard";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import type { ToolPermissionRequest } from "@/types";

export function IssueConversation() {
  const { workspaceId, issueId } = useParams();
  const [pendingPermissions, setPendingPermissions] = useState<Array<{
    messageId: number; roleName: string; request: ToolPermissionRequest;
  }>>([]);

  const handlePermissionRequired = useCallback((perm: { messageId: number; roleName: string; request: ToolPermissionRequest }) => {
    setPendingPermissions((prev) => {
      if (prev.some((p) => p.request.tool_use_id === perm.request.tool_use_id)) return prev;
      return [...prev, perm];
    });
  }, []);

  const issueQ = useQuery({ ...issueQueries.detail(issueId!), enabled: !!issueId });
  const conversationsQ = useQuery({ ...issueQueries.conversations(issueId!), enabled: !!issueId });
  const stageSuggestionQ = useQuery({ ...issueQueries.stageSuggestion(issueId!), enabled: !!issueId });

  const activeConversationId = conversationsQ.data?.[0]?.id ?? null;
  const messagesQ = useQuery({ ...conversationQueries.messages(activeConversationId ?? ""), enabled: !!activeConversationId });

  const sendMessage = useSendMessage(activeConversationId ?? "");
  const interruptMessage = useInterruptMessage(activeConversationId ?? "");
  const advanceIssue = useAdvanceIssue(issueId!, workspaceId);
  const completeIssue = useCompleteIssue(issueId!, workspaceId);
  const archiveIssue = useArchiveIssue(issueId!, workspaceId);
  const confirmSuggestion = useConfirmStageSuggestion(issueId!, workspaceId);
  const rejectSuggestion = useRejectStageSuggestion(issueId!);

  const { send } = useWebSocket(activeConversationId, handlePermissionRequired);

  const handleSend = useCallback((content: string) => {
    if (!activeConversationId) return;
    sendMessage.mutate({ content });
  }, [activeConversationId, sendMessage]);

  const handleInterrupt = useCallback((messageId: number) => {
    if (!activeConversationId) return;
    const sent = send({ type: "send_message", content: "/interrupt", from_role: "项目负责人" });
    if (!sent) {
      interruptMessage.mutate(messageId);
    }
  }, [activeConversationId, send, interruptMessage]);

  const issue = issueQ.data;
  const stage = issue?.current_stage;
  const suggestion = stageSuggestionQ.data;

  return (
    <div className="flex flex-col h-full">
      <TopBar breadcrumbs={[{ label: issue?.title ?? "Issue", to: `/ws/${workspaceId}/board` }, { label: issueId?.slice(0, 8) ?? "" }]} />

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          <div className="px-6 py-6">
            <QueryState query={issueQ}>
              {/* Header */}
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xs text-text-muted font-medium font-mono">{issue!.id.slice(0, 8)}</span>
                  {stage && <StatusBadge status={stage.status} />}
                </div>
                <h1 className="text-xl font-semibold leading-tight mb-2">{issue!.title}</h1>
                {issue!.summary && <p className="text-[14px] text-text-secondary leading-relaxed">{issue!.summary}</p>}
              </div>

              {/* Properties */}
              <div className="bg-surface-2 rounded-lg border border-white/6 mb-6 overflow-hidden">
                <div className="grid grid-cols-2 divide-x divide-white/6">
                  <div>
                    <PropRow label="Status">{stage ? <StatusBadge status={stage.status} /> : <span className="text-[13px] text-text-muted">—</span>}</PropRow>
                    <PropRow label="Stage"><span className="text-[13px]">{stage?.stage_definition?.title ?? "—"}</span></PropRow>
                    <PropRow label="SOP" last><span className="text-[13px] text-text-secondary">{issue!.sop_snapshot?.title ?? "—"}</span></PropRow>
                  </div>
                  <div>
                    <PropRow label="Created"><span className="text-[13px] text-text-secondary">{formatDate(issue!.created_at)}</span></PropRow>
                    <PropRow label="Updated"><span className="text-[13px] text-text-secondary">{formatRelativeTime(issue!.updated_at)}</span></PropRow>
                    <PropRow label="Conversations" last><span className="text-[13px] text-text-secondary">{issue!.conversation_count}</span></PropRow>
                  </div>
                </div>
              </div>

              {/* Stage Suggestion */}
              {suggestion && (
                <div className="bg-shell-600/10 border border-shell-600/30 rounded-lg p-4 mb-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[13px] font-medium text-shell-400">Stage Suggestion</p>
                      <p className="text-[12px] text-text-secondary mt-1">
                        {suggestion.fromStageKey} → {suggestion.toStageKey}
                        {suggestion.reason && `: ${suggestion.reason}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => confirmSuggestion.mutate()} disabled={confirmSuggestion.isPending}
                        className="px-3 py-1.5 rounded-md bg-shell-600 hover:bg-shell-500 text-white text-xs font-medium transition-colors disabled:opacity-50">
                        Confirm
                      </button>
                      <button onClick={() => rejectSuggestion.mutate()} disabled={rejectSuggestion.isPending}
                        className="px-3 py-1.5 rounded-md border border-white/6 text-text-secondary hover:text-text-primary text-xs transition-colors disabled:opacity-50">
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Stage Actions */}
              {stage?.status === "in_progress" && (
                <div className="flex items-center gap-2 mb-6">
                  <button onClick={() => advanceIssue.mutate()} disabled={advanceIssue.isPending}
                    className="px-3 py-1.5 rounded-md bg-shell-600 hover:bg-shell-500 text-white text-xs font-medium transition-colors disabled:opacity-50">
                    Advance Stage
                  </button>
                  <button onClick={() => completeIssue.mutate()} disabled={completeIssue.isPending}
                    className="px-3 py-1.5 rounded-md border border-status-green/30 text-status-green hover:bg-status-green/10 text-xs font-medium transition-colors disabled:opacity-50">
                    Complete
                  </button>
                  <button onClick={() => archiveIssue.mutate()} disabled={archiveIssue.isPending}
                    className="px-3 py-1.5 rounded-md border border-white/6 text-text-secondary hover:text-text-primary text-xs transition-colors disabled:opacity-50">
                    Archive
                  </button>
                </div>
              )}
            </QueryState>

            <div className="h-px bg-white/6 mb-6" />

            {/* Conversation */}
            <QueryState query={messagesQ} emptyText="No messages yet. Start the conversation below.">
              <div className="space-y-4">
                {messagesQ.data?.map((msg) => (
                  <div key={msg.id}>
                    <ChatMessage message={msg} />
                    {msg.status === "streaming" && (
                      <div className="ml-9 mt-1">
                        <button onClick={handleInterrupt}
                          className="px-2 py-1 rounded text-[11px] text-status-red hover:bg-status-red/10 transition-colors">
                          Interrupt
                        </button>
                      </div>
                    )}
                    {msg.status === "pending_approval" && pendingPermissions
                      .filter((p) => p.messageId === msg.id)
                      .map((perm) => (
                        <div key={perm.request.tool_use_id} className="ml-9">
                          <ToolApprovalCard
                            conversationId={activeConversationId!}
                            messageId={msg.id}
                            request={perm.request}
                            onDecide={() => setPendingPermissions((prev) => prev.filter((p) => p.request.tool_use_id !== perm.request.tool_use_id))}
                          />
                        </div>
                      ))
                    }
                  </div>
                ))}
              </div>
            </QueryState>

            <div className="mt-6 mb-8">
              <ChatInput onSend={handleSend} />
            </div>
          </div>
        </div>

        {issue && <PropertiesPanel issue={issue} />}
      </div>
    </div>
  );
}

function PropRow({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center px-4 py-2.5 ${!last ? "border-b border-white/4" : ""} hover:bg-white/3 transition-colors`}>
      <span className="w-24 text-xs text-text-muted shrink-0">{label}</span>
      {children}
    </div>
  );
}
