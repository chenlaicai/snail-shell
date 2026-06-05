import { useState } from "react";
import { api } from "../services/api-client";
import { showToast } from "./Toast";
import type { StageDetailDto, IssueDto, SopTransitionDto } from "../types";

export type Transition = SopTransitionDto;

export function StageActions({
  issue,
  currentStage,
  transitions,
  onStageChanged,
}: {
  issue: IssueDto;
  currentStage: StageDetailDto | null;
  transitions: Transition[];
  onStageChanged: () => void;
}) {
  const [advancing, setAdvancing] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string>("");

  if (!currentStage || issue.closed_at) return null;

  const forward = transitions.filter(
    (t) => t.from_stage_key === currentStage.type && t.to_stage_key !== currentStage.type
  );

  async function handleAdvance() {
    if (advancing || forward.length === 0) return;
    setAdvancing(true);
    try {
      const targetKey = forward.length === 1
        ? forward[0].to_stage_key
        : selectedTarget || forward[0].to_stage_key;
      if (!targetKey) { showToast("请选择目标阶段", true); setAdvancing(false); return; }
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
    <div className="conv-stage-tabs">
      {forward.length > 1 && (
        <select
          className="secondary-button"
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
        className="secondary-button"
        onClick={handleAdvance}
        disabled={advancing || forward.length === 0}
        title={forward.length === 0 ? "当前阶段无可用前进目标" : "推进到下一阶段"}
      >
        推进阶段
      </button>
      {forward.length > 1 && (
        <select
          className="secondary-button"
          onChange={(e) => { if (e.target.value) handleBounce(e.target.value); e.target.value = ""; }}
        >
          <option value="">转移到...</option>
          {forward.map((t) => (
            <option key={t.to_stage_key} value={t.to_stage_key}>{t.to_stage_key}</option>
          ))}
        </select>
      )}
    </div>
  );
}
