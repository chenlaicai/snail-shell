import { useMemo, useState } from "react";
import { api } from "@/services/api-client";
import { showToast } from "@/components/Toast";
import type { IssueDetailDto, StageDetailDto, StageTransition } from "@/types";

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
  const [selectedTarget, setSelectedTarget] = useState("");

  const transitions = useMemo<StageTransition[]>(() => {
    if (!currentStage) return [];
    const fromStage = currentStage.key;
    const candidates = currentStage.available_transitions?.length
      ? currentStage.available_transitions
      : issue.sop_snapshot?.transitions ?? [];
    return candidates.filter((transition) => transition.from === fromStage && transition.to !== fromStage);
  }, [currentStage, issue.sop_snapshot?.transitions]);

  if (!currentStage || issue.closed_at || currentStage.status !== "in_progress") return null;

  const needsSelection = transitions.length > 1 && !selectedTarget;

  async function handleAdvance() {
    if (!currentStage || advancing || transitions.length === 0 || needsSelection) return;
    setAdvancing(true);
    try {
      const targetKey = transitions.length === 1 ? transitions[0].to : selectedTarget;
      if (!targetKey) { showToast("请选择目标阶段", true); return; }
      const stage = await api("POST /api/stages/:stageId/advance", {
        params: { stageId: currentStage.id },
        body: { target_key: targetKey },
      });
      showToast("阶段已推进");
      onStageChanged(stage);
      setSelectedTarget("");
    } catch (err: unknown) {
      showToast(`推进失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
    setAdvancing(false);
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
        disabled={advancing || transitions.length === 0 || needsSelection}
        className="rounded-md bg-shell-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-shell-500 disabled:opacity-50"
      >
        {advancing ? "Advancing..." : "Advance Stage"}
      </button>
    </div>
  );
}
