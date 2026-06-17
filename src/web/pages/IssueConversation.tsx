import { useParams } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { api } from "@/services/api-client";
import { queryKeys } from "@/queries/keys";
import { TopBar } from "@/components/TopBar";
import { StatusBadge } from "@/components/StatusBadge";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { PropertiesPanel } from "@/components/PropertiesPanel";
import { showToast } from "@/components/Toast";
import { createPlaceholderMessage } from "@/hooks/useWebSocket";
import type { IssueDetailDto, StageDetailDto, MessageDto } from "@/types";

export function IssueConversation() {
  const { workspaceId, issueId } = useParams();
  const queryClient = useQueryClient();

  const { data: issue, isLoading: issueLoading } = useQuery({
    queryKey: queryKeys.issues.detail(issueId ?? ""),
    queryFn: () => api("GET /api/issues/:issueId", { params: { issueId: issueId! } }) as Promise<IssueDetailDto>,
    enabled: !!issueId,
  });

  const activeStage: StageDetailDto | null = issue?.current_stage ?? issue?.stages?.[0] ?? null;
  const stageId = activeStage?.id ?? null;

  const { data: messages = [] } = useQuery({
    queryKey: queryKeys.stages.messages(stageId ?? ""),
    queryFn: () => api("GET /api/stages/:stageId/messages", { params: { stageId: stageId! } }) as Promise<MessageDto[]>,
    enabled: !!stageId,
  });

  const sorted = useMemo(() =>
    [...messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [messages],
  );

  const sendMutation = useMutation({
    mutationFn: (text: string) =>
      api("POST /api/stages/:stageId/messages", { params: { stageId: stageId! }, body: { text } }),
    onMutate: (text) => {
      if (!stageId) return;
      const optimistic = createPlaceholderMessage(stageId, { id: Date.now(), role: "user", content: text });
      queryClient.setQueryData(queryKeys.stages.messages(stageId), (old: MessageDto[] | undefined) => [...(old ?? []), optimistic]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.stages.messages(stageId!) });
    },
    onError: (err: unknown) => {
      showToast(`发送失败：${err instanceof Error ? err.message : String(err)}`, true);
      if (stageId) queryClient.invalidateQueries({ queryKey: queryKeys.stages.messages(stageId) });
    },
  });

  const handleSend = useCallback((content: string) => {
    if (!stageId) return;
    sendMutation.mutate(content);
  }, [stageId, sendMutation]);

  const stage = activeStage;

  if (issueLoading) {
    return (
      <>
        <TopBar breadcrumbs={[{ label: "Loading..." }]} />
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">Loading issue...</div>
      </>
    );
  }

  if (!issue) {
    return (
      <>
        <TopBar breadcrumbs={[{ label: "Issue not found" }]} />
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">Issue not found</div>
      </>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar breadcrumbs={[
        { label: issue.title ?? issueId?.slice(0, 8) ?? "", to: `/workspaces/${workspaceId}/board` },
        { label: issueId?.slice(0, 8) ?? "" },
      ]} />

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto flex w-full max-w-[920px] flex-col gap-5">

              {/* Issue header */}
              <div className="mb-2">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xs text-text-muted font-medium font-mono">{issue.id.slice(0, 8)}</span>
                  {stage && <StatusBadge status={stage.status} />}
                </div>
                <h1 className="text-xl font-semibold leading-tight mb-2">{issue.title}</h1>
                {issue.summary && <p className="text-[14px] text-text-secondary leading-relaxed">{issue.summary}</p>}
              </div>

              {/* Issue properties grid */}
              <div className="bg-surface-2 rounded-lg border border-white/6 overflow-hidden">
                <div className="grid grid-cols-2 divide-x divide-white/6">
                  <div>
                    <PropRow label="Status">{stage ? <StatusBadge status={stage.status} /> : <span className="text-[13px] text-text-muted">—</span>}</PropRow>
                    <PropRow label="Stage"><span className="text-[13px]">{stage?.stage_definition?.title ?? "—"}</span></PropRow>
                    <PropRow label="SOP" last><span className="text-[13px] text-text-secondary">{issue.sop_snapshot?.name ?? "—"}</span></PropRow>
                  </div>
                  <div>
                    <PropRow label="Created"><span className="text-[13px] text-text-secondary">{issue.created_at ? new Date(issue.created_at).toLocaleDateString() : "—"}</span></PropRow>
                    <PropRow label="Closed"><span className="text-[13px] text-text-secondary">{issue.closed_at ? new Date(issue.closed_at).toLocaleDateString() : "—"}</span></PropRow>
                    <PropRow label="Stages" last><span className="text-[13px] text-text-secondary">{issue.stages?.length ?? 0}</span></PropRow>
                  </div>
                </div>
              </div>

              {/* Stage actions */}
              {stage?.status === "in_progress" && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => showToast("Advance 功能暂未接入", true)}
                    className="px-3 py-1.5 rounded-md bg-shell-600 hover:bg-shell-500 text-white text-xs font-medium transition-colors"
                  >
                    Advance Stage
                  </button>
                  <button
                    onClick={() => showToast("Complete 功能暂未接入", true)}
                    className="px-3 py-1.5 rounded-md border border-status-green/30 text-status-green hover:bg-status-green/10 text-xs font-medium transition-colors"
                  >
                    Complete
                  </button>
                </div>
              )}

              <div className="h-px bg-white/6" />

              {/* Messages */}
              {sorted.length === 0 && <div className="text-center text-text-muted text-sm py-8">No messages yet. Start the conversation below.</div>}

              {sorted.map((msg) => (
                <div key={msg.id} className="px-0 py-1">
                  {stageId && <ChatMessage message={msg} />}
                  {/* ToolApprovalCard: shown when message has tool_call events with pending approval */}
                </div>
              ))}
            </div>
          </div>

          {/* Input */}
          <div className="shrink-0 px-6 pb-8 pt-4">
            <div className="mx-auto max-w-[920px]">
              <ChatInput onSend={handleSend} disabled={!stageId || stage?.status !== "in_progress"} />
            </div>
          </div>
        </div>

        <PropertiesPanel issue={issue} stage={stage} />
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
