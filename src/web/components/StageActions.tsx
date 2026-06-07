import { useState } from "react";
import { api } from "../services/api-client";
import { showToast } from "./Toast";

interface Stage {
  id: string;
  type: string;
  status: string;
  stage_definition?: { title?: string; sequence?: number };
}

interface Issue {
  id: string;
  title: string;
  closed_at?: string | null;
}

export interface Transition {
  from_stage_key: string;
  to_stage_key: string;
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
    (t) => t.from_stage_key === currentStage.type && t.to_stage_key !== currentStage.type
  );

  const needsSelection = forward.length > 1 && !selectedTarget;

  async function handleAdvance() {
    if (advancing || forward.length === 0 || needsSelection) return;
    setAdvancing(true);
    try {
      const targetKey = forward.length === 1
        ? forward[0].to_stage_key
        : selectedTarget;
      const result = await api("POST /api/issues/:issueId/advance", { params: { issueId: issue.id }, body: { target_stage_key: targetKey } });
      showToast("阶段已推进");
      // 自动触发 AI 工作
      if (result?.conversation?.id) {
        api("POST /api/conversations/:conversationId/messages", { params: { conversationId: result.conversation.id }, body: { content: "开始执行。" } }).catch(() => {});
      }
      onStageChanged();
    } catch (err: unknown) {
      showToast(`推进失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
    setAdvancing(false);
  }

  async function handleBounce(toKey: string) {
    try {
      const result = await api("POST /api/issues/:issueId/bounce-stage", { params: { issueId: issue.id }, body: { target_stage_key: toKey } });
      showToast("阶段已转移");
      // 自动触发 AI 工作
      if (result?.conversation?.id) {
        api("POST /api/conversations/:conversationId/messages", { params: { conversationId: result.conversation.id }, body: { content: "开始执行。" } }).catch(() => {});
      }
      onStageChanged();
    } catch (err: unknown) {
      showToast(`转移失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
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
          {forward.map((t) => (
            <option key={t.to_stage_key} value={t.to_stage_key}>{t.to_stage_key}</option>
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
      {forward.length > 1 && (
        <button
          className="px-[var(--space-md)] py-[var(--space-xs)] rounded-[var(--radius-sm)] text-[12px] border border-[var(--color-border-muted)] text-[var(--color-text-muted)] hover:border-[var(--color-border-default)] hover:text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => { if (selectedTarget) handleBounce(selectedTarget); }}
          disabled={!selectedTarget}
        >
          转移
        </button>
      )}
    </div>
  );
}
