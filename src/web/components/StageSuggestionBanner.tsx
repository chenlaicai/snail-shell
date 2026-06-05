/**
 * StageSuggestionBanner - AI 提议的阶段转移横幅
 *
 * 当 AI 建议从当前阶段推进到下一阶段时显示确认/拒绝 UI。
 */

import { useState, useEffect } from "react";
import { api } from "../services/api";
import { showToast } from "./Toast";

interface StageSuggestion {
  issueId: string;
  fromStageKey: string;
  toStageKey: string;
  reason?: string;
}

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
    api("GET", `/issues/${issueId}/stage-suggestion`)
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
      await api("POST", `/issues/${issueId}/advance`, { target_stage_key: suggestion!.toStageKey });
      showToast("阶段已推进");
      setSuggestion(null);
      onAccepted();
    } catch (err: any) {
      showToast(`推进失败：${err.message}`, true);
    }
  }

  function handleDismiss() {
    setSuggestion(null);
  }

  return (
    <div className="stage-suggestion-banner">
      <div className="suggestion-content">
        <span className="suggestion-text">
          AI 建议从 <strong>{suggestion.fromStageKey}</strong> 推进到 <strong>{suggestion.toStageKey}</strong>
          {suggestion.reason && "："}
        </span>
        {suggestion.reason && <span className="suggestion-reason">{suggestion.reason}</span>}
      </div>
      <div className="suggestion-actions">
        <button className="suggestion-confirm-btn" onClick={handleConfirm}>确认推进</button>
        <button className="suggestion-reject-btn" onClick={handleDismiss}>忽略</button>
      </div>
    </div>
  );
}
