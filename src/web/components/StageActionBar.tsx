import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, BlockedError } from "@/services/api-client";
import { showToast } from "@/components/Toast";
import { CloseIssueDialog } from "@/components/CloseIssueDialog";
import { ForceAdvanceDialog } from "@/components/ForceAdvanceDialog";
import { useCloseIssue } from "@/mutations/issue.mutations";
import { queryKeys } from "@/queries/keys";
import type { IssueDetailDto, StageDetailDto, StageTransition, CleanupResultDto } from "@/types";

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
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState("");
  const [blockedReasons, setBlockedReasons] = useState<Array<{ code: string; severity: string; message: string; details?: Record<string, unknown> }> | null>(null);
  const [blockedTargetKey, setBlockedTargetKey] = useState("");
  const closeIssue = useCloseIssue(issue.workspace_id);
  const qc = useQueryClient();
  /** 记录上次看到的 close_summary，用于检测从 null → 有值的转变 */
  const prevCloseSummaryRef = useRef<CleanupResultDto | null | undefined>(issue.close_summary);

  /** 订阅 close_summary 变化：WebSocket cleanup_completed 更新 cache 后弹 toast */
  useEffect(() => {
    const targetKey = queryKeys.issues.detail(issue.id);
    return qc.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") return;
      const qk = event.query.queryKey;
      if (qk.length !== targetKey.length || qk[0] !== targetKey[0] || qk[1] !== targetKey[1]) return;
      const data = event.query.state.data as IssueDetailDto | undefined;
      const current = data?.close_summary;
      const prev = prevCloseSummaryRef.current;
      prevCloseSummaryRef.current = current;
      if (prev == null && current != null) {
        showToast(formatCleanupResult(current));
      }
    });
  }, [qc, issue.id]);

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
      if (err instanceof BlockedError && err.evaluation.reasons.length > 0) {
        /** 409 阻断：弹出确认对话框而非 toast，让用户可以强制推进 */
        setBlockedReasons(err.evaluation.reasons);
        setBlockedTargetKey(targetKey);
      } else {
        showToast(`推进失败：${err instanceof Error ? err.message : String(err)}`, true);
      }
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
      const r = cleanup[key as keyof CleanupResultDto];
      if (r.status === "merged") lines.push(`- ${label}: 已合入`);
      else if (r.status === "closed") lines.push(`- ${label}: 已关闭`);
      else if (r.status === "success") lines.push(`- ${label}: 已清理`);
      else if (r.status === "skipped") lines.push(`- ${label}: 跳过${r.error ? `（${r.error}）` : ""}`);
      else if (r.status === "failed") lines.push(`- ${label}: 失败${r.error ? `（${r.error}）` : ""}`);
      else lines.push(`- ${label}: ${r.status}`);
    }
    return lines.join("\n");
  }

  function handleClose() {
    setShowCloseDialog(true);
  }

  function confirmClose() {
    setIsClosing(true);
    closeIssue.mutate(issue.id, {
      onSuccess: () => {
        setIsClosing(false);
        setShowCloseDialog(false);
        showToast("Issue 已关闭");
      },
      onError: (err: unknown) => {
        setIsClosing(false);
        showToast(`关闭失败：${err instanceof Error ? err.message : String(err)}`, true);
      },
    });
  }

  return (
    <div className="rounded-lg border border-white/6 bg-surface-2 p-3 space-y-2">
      <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">Stage Actions</span>
      {transitions.length > 1 && (
        <select
          value={selectedTarget}
          onChange={(e) => setSelectedTarget(e.target.value)}
          className="w-full rounded-md border border-white/6 bg-surface-0 px-2.5 py-1.5 text-xs text-text-primary focus:border-shell-600/40 focus:outline-none"
        >
          <option value="">Select target...</option>
          {transitions.map((transition) => <option key={transition.to} value={transition.to}>{transition.to}</option>)}
        </select>
      )}
      <button
        onClick={handleAdvance}
        disabled={advancing || isClosing || transitions.length === 0 || needsSelection}
        className="w-full rounded-md bg-shell-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-shell-500 disabled:opacity-50"
      >
        {advancing ? "Advancing..." : "Advance Stage"}
      </button>
      <button
        onClick={handleClose}
        disabled={closeIssue.isPending || isClosing}
        className="w-full rounded-md border border-white/10 bg-surface-0 px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary hover:border-white/20 disabled:opacity-50"
      >
        {closeIssue.isPending || isClosing ? "Closing..." : "Close Issue"}
      </button>
      <CloseIssueDialog
        open={showCloseDialog}
        onClose={() => setShowCloseDialog(false)}
        onConfirm={confirmClose}
        closing={isClosing}
      />
      {currentStage && blockedReasons && (
        <ForceAdvanceDialog
          open={!!blockedReasons}
          onClose={() => { setBlockedReasons(null); setBlockedTargetKey(""); }}
          onConfirmed={(stage) => { onStageChanged(stage); setSelectedTarget(""); setBlockedReasons(null); setBlockedTargetKey(""); }}
          stageId={currentStage.id}
          targetKey={blockedTargetKey}
          reasons={blockedReasons}
        />
      )}
    </div>
  );
}
