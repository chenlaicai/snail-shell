import { useMemo, useState } from "react";
import { api } from "@/services/api-client";
import { showToast } from "@/components/Toast";
import { useCloseIssue } from "@/mutations/issue.mutations";
import type { IssueDetailDto, StageDetailDto, StageTransition, CleanupResultDto, ResourceResultDto } from "@/types";

export function StageActionBar({
  issue,
  currentStage,
  onStageChanged,
}: {
  issue: IssueDetailDto;
  currentStage: StageDetailDto | null;
  onStageChanged: (stage: StageDetailDto) => void;
}) {
  const [advancing, setAdvancing] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState("");
  const closeIssue = useCloseIssue(issue.workspace_id);

  const transitions = useMemo<StageTransition[]>(() => {
    if (!currentStage) return [];
    if (currentStage.available_transitions.length > 0) {
      return currentStage.available_transitions.filter((transition) => transition.to !== currentStage.key);
    }
    return (issue.sop_snapshot?.transitions ?? []).filter((transition) => transition.from === currentStage.key && transition.to !== currentStage.key);
  }, [currentStage, issue.sop_snapshot?.transitions]);

  if (!currentStage || issue.closed_at || currentStage.status !== "in_progress") return null;

  const needsSelection = transitions.length > 1 && !selectedTarget;

  async function handleAdvance() {
    if (!currentStage || advancing || isClosing || transitions.length === 0 || needsSelection) return;
    const targetKey = transitions.length === 1 ? transitions[0].to : selectedTarget;
    if (!targetKey) { showToast("请选择目标阶段", true); return; }
    setAdvancing(true);
    try {
      const stage = await api("POST /api/stages/:stageId/advance", {
        params: { stageId: currentStage.id },
        body: { target_key: targetKey },
      });
      showToast("阶段已推进");
      onStageChanged(stage);
      setSelectedTarget("");
    } catch (err: unknown) {
      showToast(`推进失败：${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setAdvancing(false);
    }
  }

  function formatCleanupResult(cleanup: CleanupResultDto): string {
    const lines: string[] = ["Issue 已关闭"];
    const labels: Record<keyof CleanupResultDto, string> = {
      pr: "PR",
      worktree: "Worktree",
      localBranch: "本地分支",
      remoteBranch: "远端分支",
    };
    for (const [key, label] of Object.entries(labels)) {
      const r = cleanup[key as keyof CleanupResultDto] as ResourceResultDto;
      if (r.status === "success") lines.push(`- ${label}: 已清理`);
      else if (r.status === "skipped") lines.push(`- ${label}: 跳过${r.error ? `（${r.error}）` : ""}`);
      else lines.push(`- ${label}: 失败${r.error ? `（${r.error}）` : ""}`);
    }
    return lines.join("\n");
  }

  function handleClose() {
    if (!window.confirm("确认关闭此 Issue？关闭后对话保留为只读")) return;
    setIsClosing(true);
    closeIssue.mutate(issue.id, {
      onSuccess: (data) => {
        setIsClosing(false);
        showToast(formatCleanupResult(data.cleanup));
      },
      onError: (err: unknown) => {
        setIsClosing(false);
        showToast(`关闭失败：${err instanceof Error ? err.message : String(err)}`, true);
      },
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/6 bg-surface-2 px-3 py-2">
      <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">Stage Actions</span>
      <div className="flex-1" />
      {transitions.length > 1 && (
        <select
          value={selectedTarget}
          onChange={(e) => setSelectedTarget(e.target.value)}
          className="rounded-md border border-white/6 bg-surface-0 px-2.5 py-1.5 text-xs text-text-primary focus:border-shell-600/40 focus:outline-none"
        >
          <option value="">Select target...</option>
          {transitions.map((transition) => <option key={transition.to} value={transition.to}>{transition.to}</option>)}
        </select>
      )}
      <button
        onClick={handleAdvance}
        disabled={advancing || isClosing || transitions.length === 0 || needsSelection}
        className="rounded-md bg-shell-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-shell-500 disabled:opacity-50"
      >
        {advancing ? "Advancing..." : "Advance Stage"}
      </button>
      <div className="w-px h-5 bg-white/10" />
      <button
        onClick={handleClose}
        disabled={closeIssue.isPending || isClosing}
        className="rounded-md border border-white/10 bg-surface-0 px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary hover:border-white/20 disabled:opacity-50"
      >
        {closeIssue.isPending || isClosing ? "Closing..." : "Close Issue"}
      </button>
    </div>
  );
}
