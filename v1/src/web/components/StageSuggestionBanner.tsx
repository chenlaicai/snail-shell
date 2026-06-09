/**
 * StageSuggestionBanner - AI 提议的阶段转移横幅
 *
 * 当 AI 建议从当前阶段推进到下一阶段时显示确认/拒绝 UI。
 */

import { useState, useEffect } from "react";
import { api } from "../services/api-client";
import { showToast } from "./Toast";
import type { StageSuggestion } from "../types";

export function StageSuggestionBanner({
  issueId,
  onAccepted,
}: {
  issueId: string | null;
  onAccepted: () => void;
}) {
  const [suggestion, setSuggestion] = useState<StageSuggestion | null>(null);

  // 检查是否有待确认的阶段转移建议
  useEffect(() => {
    if (!issueId) { setSuggestion(null); return; }
    api("GET /api/issues/:issueId/stage-suggestion", { params: { issueId } })
      .then((data) => {
        if (data && data.issueId === issueId) {
          setSuggestion(data);
        } else {
          setSuggestion(null);
        }
      })
      .catch(() => setSuggestion(null));
  }, [issueId]);

  if (!suggestion) return null;

  async function handleConfirm() {
    try {
      await api("POST /api/issues/:issueId/advance", { params: { issueId }, body: { target_stage_key: suggestion!.toStageKey } });
      showToast("阶段已推进");
      setSuggestion(null);
      onAccepted();
    } catch (err: unknown) {
      showToast(`推进失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  function handleDismiss() {
    setSuggestion(null);
  }

  return (
    <div className="flex items-center justify-between gap-[var(--space-md)] mx-[var(--space-lg)] my-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)] bg-[rgba(108,141,250,0.08)] border border-[rgba(108,141,250,0.2)] rounded-[var(--radius-md)]">
      <div className="flex-1 min-w-0">
        <span className="text-[var(--font-size-sm)] text-[var(--color-text-primary)]">
          AI 建议从 <strong className="text-[var(--color-accent)]">{suggestion.fromStageKey}</strong> 推进到 <strong className="text-[var(--color-accent)]">{suggestion.toStageKey}</strong>
          {suggestion.reason && "："}
        </span>
        {suggestion.reason && <span className="text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">{suggestion.reason}</span>}
      </div>
      <div className="flex gap-[var(--space-xs)] shrink-0">
        <button className="px-[var(--space-md)] py-[var(--space-xs)] text-[var(--font-size-xs)] bg-[var(--color-accent)] text-[var(--color-background)] rounded-[var(--radius-sm)] font-medium hover:opacity-90" onClick={handleConfirm}>确认推进</button>
        <button className="px-[var(--space-md)] py-[var(--space-xs)] text-[var(--font-size-xs)] border border-[var(--color-border-muted)] text-[var(--color-text-muted)] rounded-[var(--radius-sm)] hover:border-[var(--color-border-default)] hover:text-[var(--color-text-primary)]" onClick={handleDismiss}>忽略</button>
      </div>
    </div>
  );
}
