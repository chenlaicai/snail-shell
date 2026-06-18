import { useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { api } from "@/services/api-client";
import { queryKeys } from "@/queries/keys";
import { TopBar } from "@/components/TopBar";
import { StatusBadge } from "@/components/StatusBadge";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { PropertiesPanel } from "@/components/PropertiesPanel";
import { StageActionBar } from "@/components/StageActionBar";
import { StageSuggestionCard } from "@/components/StageSuggestionCard";
import { useIssueRealtime } from "@/hooks/useWebSocket";
import { useSendMessage } from "@/mutations/conversation.mutations";
import type { IssueDetailDto, StageDetailDto } from "@/types";

export function IssueConversation() {
  const { workspaceId, issueId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const { data: issue, isLoading: issueLoading } = useQuery({
    queryKey: queryKeys.issues.detail(issueId ?? ""),
    queryFn: () => api("GET /api/issues/:issueId", { params: { issueId: issueId! } }) as Promise<IssueDetailDto>,
    enabled: !!issueId,
  });

  const { data: workspace } = useQuery({
    queryKey: queryKeys.workspaces.detail(workspaceId ?? ""),
    queryFn: () => api("GET /api/workspaces/:workspaceId", { params: { workspaceId: workspaceId! } }),
    enabled: !!workspaceId,
  });

  const selectedStageId = searchParams.get("stage");
  const activeStage: StageDetailDto | null = useMemo(() => {
    if (!issue) return null;
    if (selectedStageId) {
      const matched = issue.stages.find((stage) => stage.id === selectedStageId);
      if (matched) return matched;
    }
    return issue.current_stage;
  }, [issue, selectedStageId]);

  const stageId = useMemo(() => activeStage?.id ?? null, [activeStage]);

  useIssueRealtime(issueId ?? null, stageId);

  useEffect(() => {
    if (!stageId || selectedStageId === stageId) return;
    setSearchParams({ stage: stageId }, { replace: true });
  }, [stageId, selectedStageId, setSearchParams]);

  const { data: messages = [] } = useQuery({
    queryKey: queryKeys.stages.messages(stageId ?? ""),
    queryFn: () => api("GET /api/stages/:stageId/messages", { params: { stageId: stageId! } }) as Promise<MessageDto[]>,
    enabled: !!stageId,
  });

  const sorted = useMemo(() =>
    [...messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [messages],
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      requestAnimationFrame(() => el.scrollTop = el.scrollHeight);
    }
  }, [sorted]);

  const sendMutation = useSendMessage(stageId ?? "");

  const handleSend = useCallback((content: string, toSpeakers: string[]) => {
    if (!stageId) return;
    sendMutation.mutate({ text: content, to_speakers: toSpeakers.length > 0 ? toSpeakers : undefined });
  }, [stageId, sendMutation]);

  const handleStageChanged = useCallback((nextStage: StageDetailDto) => {
    if (!issueId) return;
    queryClient.setQueryData(queryKeys.issues.detail(issueId), (old: IssueDetailDto | null | undefined) => {
      if (!old) return old;
      const stages = old.stages.some((stage) => stage.id === nextStage.id)
        ? old.stages.map((stage) => stage.id === nextStage.id ? nextStage : stage)
        : [...old.stages, nextStage];
      return { ...old, stages, current_stage: nextStage };
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
    if (workspaceId) queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) });
    setSearchParams({ stage: nextStage.id }, { replace: true });
  }, [issueId, queryClient, setSearchParams, workspaceId]);

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
        { label: "Workspaces", to: "/workspaces" },
        { label: workspace?.summary ?? workspace?.path ?? workspaceId ?? "", to: `/workspaces/${workspaceId}/board` },
        { label: issue.title || issueId?.slice(0, 8) || "" },
      ]} />

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
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

              {issue.stages.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {issue.stages.map((item) => {
                    const active = item.id === stageId;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setSearchParams({ stage: item.id }, { replace: true })}
                        className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${active ? "bg-white/8 text-text-primary" : "text-text-secondary hover:bg-white/5 hover:text-text-primary"}`}
                      >
                        {item.stage_definition?.title ?? item.title ?? item.type}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Issue properties grid */}
              <div className="bg-surface-2 rounded-lg border border-white/6 overflow-hidden">
                <div className="grid grid-cols-2 divide-x divide-white/6">
                  <div>
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

              <StageSuggestionCard stageId={stageId} onAccepted={handleStageChanged} />
              <StageActionBar issue={issue} currentStage={stage} onStageChanged={handleStageChanged} />

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
              {stage?.status === "completed" ? (
                <div className="rounded-2xl border border-white/6 bg-surface-2 px-4 py-3 text-[12px] text-text-muted">
                  当前 Stage 已结束，历史对话保留为只读。请切换到当前 Stage 继续对话。
                </div>
              ) : (
                <ChatInput onSend={handleSend} disabled={!stageId || stage?.status !== "in_progress"} roleInstances={stage?.role_instances ?? []} />
              )}
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
