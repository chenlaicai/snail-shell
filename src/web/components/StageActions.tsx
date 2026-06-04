import { useState } from "react";
import { api } from "../services/api";
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
  adopted_sop_id?: string;
}

interface Transition {
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

  async function handleAdvance() {
    if (advancing || forward.length === 0) return;
    setAdvancing(true);
    try {
      // Multiple targets: use selected or prompt user
      const targetKey = forward.length === 1
        ? forward[0].to_stage_key
        : selectedTarget || forward[0].to_stage_key;
      if (!targetKey) { showToast("请选择目标阶段", true); setAdvancing(false); return; }
      await api("POST", `/issues/${issue.id}/advance`, { target_stage_key: targetKey });
      showToast("阶段已推进");
      onStageChanged();
    } catch (err: any) {
      showToast(`推进失败：${err.message}`, true);
    }
    setAdvancing(false);
  }

  async function handleBounce(toKey: string) {
    try {
      await api("POST", `/issues/${issue.id}/stages/${currentStage.id}/bounce`, { target_stage_key: toKey });
      showToast("阶段已转移");
      onStageChanged();
    } catch (err: any) {
      showToast(`转移失败：${err.message}`, true);
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
