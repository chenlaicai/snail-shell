import { useState } from "react";
import { api } from "../services/api-client";
import { showToast } from "./Toast";
import type { RoleSnailAssignment } from "../types";

interface Stage {
  id: string;
  key: string;
  type: string;
  status: string;
  assignments?: RoleSnailAssignment[];
  stage_definition?: { title?: string; sequence?: number };
}

interface Issue {
  id: string;
  title: string;
  closed_at?: string | null;
}

export interface Transition {
  from: string;
  to: string;
  guard: string | null;
}

export function StageActions({
  issue,
  currentStage,
  transitions,
  onStageChanged,
}: {
  issue: Issue;
  currentStage: Stage | null;
  transitions: Transition[];
  onStageChanged: () => void;
}) {
  const [advancing, setAdvancing] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string>("");

  if (!currentStage || issue.closed_at) return null;

  const forward = transitions.filter(
    (transition) => transition.from === currentStage.key && transition.to !== currentStage.key
  );

  const needsSelection = forward.length > 1 && !selectedTarget;
  const snailAssignments = Object.fromEntries(
    (currentStage.assignments ?? []).map((assignment) => [assignment.role_instance, assignment.snail_key])
  );

  async function handleAdvance() {
    if (!currentStage || advancing || forward.length === 0 || needsSelection) return;
    setAdvancing(true);
    try {
      const targetKey = forward.length === 1
        ? forward[0].to
        : selectedTarget;
      if (!targetKey) { showToast("请选择目标阶段", true); setAdvancing(false); return; }
      const nextStage = await api("POST /api/stages/:stageId/advance", {
        params: { stageId: currentStage.id },
        body: { target_key: targetKey, snail_assignments: snailAssignments },
      });
      showToast("阶段已推进");
      api("POST /api/stages/:stageId/messages", { params: { stageId: nextStage.id }, body: { text: "开始执行。" } }).catch(() => {});
      onStageChanged();
    } catch (err: unknown) {
      showToast(`推进失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
    setAdvancing(false);
  }

  return (
    <div className="flex items-center gap-[var(--space-xs)] px-[var(--space-lg)] py-[var(--space-sm)] border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
      {forward.length > 1 && (
        <select
          className="px-[var(--space-md)] py-[var(--space-xs)] rounded-[var(--radius-sm)] text-[12px] border border-[var(--color-border-muted)] text-[var(--color-text-muted)] bg-[var(--color-bg-input)] hover:border-[var(--color-border-default)]"
          value={selectedTarget}
          onChange={(e) => setSelectedTarget(e.target.value)}
        >
          <option value="">选择目标阶段</option>
          {forward.map((transition) => (
            <option key={transition.to} value={transition.to}>{transition.to}</option>
          ))}
        </select>
      )}
      <button
        className="px-[var(--space-md)] py-[var(--space-xs)] rounded-[var(--radius-sm)] text-[12px] border border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-bg-elevated)] hover:bg-[rgba(108,141,250,0.08)] disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={handleAdvance}
        disabled={advancing || forward.length === 0 || needsSelection}
        title={forward.length === 0 ? "当前阶段无可用前进目标" : needsSelection ? "请先选择目标阶段" : "推进到下一阶段"}
      >
        推进
      </button>
    </div>
  );
}
