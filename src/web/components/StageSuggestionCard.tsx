import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { api, BlockedError } from "@/services/api-client";
import { showToast } from "@/components/Toast";
import { ForceAdvanceDialog } from "@/components/ForceAdvanceDialog";
import type { StageDetailDto, StageSuggestion } from "@/types";

/** 信号类型中文映射 */
const SIGNAL_TYPE_LABEL: Record<string, string> = {
  gate_complete: "单人完成",
  adversarial_consensus: "对抗共识",
  disagreement: "分歧",
};

export function StageSuggestionCard({
  stageId,
  onAccepted,
}: {
  stageId: string | null;
  onAccepted: (stage: StageDetailDto) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [blockedReasons, setBlockedReasons] = useState<Array<{ code: string; severity: string; message: string; details?: Record<string, unknown> }> | null>(null);
  const [userHint, setUserHint] = useState("");
  const [showHintInput, setShowHintInput] = useState(false);
  const { data: suggestions = [], refetch } = useQuery({
    queryKey: ["stages", stageId, "transition-suggestions"],
    queryFn: () => api("GET /api/stages/:stageId/transition-suggestions", { params: { stageId: stageId! } }),
    enabled: !!stageId,
  });

  const suggestion = (suggestions as StageSuggestion[])[0] ?? null;

  /** suggestion 变更时重置 hint 状态，防止 stale hint 被发送到新 suggestion */
  useEffect(() => {
    setUserHint("");
    setShowHintInput(false);
  }, [suggestion?.target_key, suggestion?.created_at]);

  /** B1: 组件挂载并显示 suggestion 时，自动标记为已阅。不在当前会话清除显示——用户仍可 Confirm/Ignore */
  useEffect(() => {
    if (!stageId || !suggestion) return;
    api("PATCH /api/stages/:stageId/transition-suggestions/:targetKey/acknowledge", {
      params: { stageId, targetKey: suggestion.target_key },
      body: { created_at: suggestion.created_at },
    }).catch(() => { /* B5: acknowledge 失败不影响当前会话 */ });
  }, [stageId, suggestion?.target_key, suggestion?.created_at]);

  if (!stageId || !suggestion) return null;

  const signalType = suggestion.signal_type;

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const stage = await api("POST /api/stages/:stageId/advance", {
        params: { stageId },
        body: { target_key: suggestion.target_key, user_hint: userHint.trim() || undefined },
      });
      showToast("阶段已推进");
      onAccepted(stage);
      refetch();
      setUserHint("");
      setShowHintInput(false);
    } catch (err: unknown) {
      if (err instanceof BlockedError && err.evaluation.reasons.length > 0) {
        /** 409 阻断：弹出确认对话框而非 toast，让用户可以强制推进 */
        setBlockedReasons(err.evaluation.reasons);
      } else {
        showToast(`推进失败：${err instanceof Error ? err.message : String(err)}`, true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDismiss() {
    if (dismissing) return;
    setDismissing(true);
    try {
      await api("DELETE /api/stages/:stageId/transition-suggestions/:targetKey", {
        params: { stageId, targetKey: suggestion.target_key },
        query: { created_at: suggestion.created_at },
      });
      refetch();
      setUserHint("");
      setShowHintInput(false);
    } catch (err: unknown) {
      showToast(`忽略失败：${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setDismissing(false);
    }
  }

  return (
    <>
    <div className="rounded-lg border border-shell-600/30 bg-shell-600/10 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-shell-400">Stage Suggestion</div>
          <div className="mt-1 text-[12px] leading-5 text-text-secondary">
            Snail 建议由 <span className="text-text-primary">{suggestion.from_speaker}</span> 推进到 <span className="text-text-primary">{suggestion.target_key}</span>
            {suggestion.reason && `：${suggestion.reason}`}
          </div>

          {/* 信号类型 */}
          {signalType && (
            <div className="mt-1 text-[11px] leading-4 text-text-secondary">
              📋 信号类型：<span className="text-text-primary">{SIGNAL_TYPE_LABEL[signalType] ?? signalType}</span>
            </div>
          )}

          {/* 重复建议提示 (B5) */}
          {suggestion.dismiss_count != null && suggestion.dismiss_count >= 3 && (
            <div className="mt-1 text-[11px] leading-4 text-amber-400">
              ⚠️ 该建议已被忽略 {suggestion.dismiss_count} 次
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex gap-2">
            <button onClick={handleConfirm} disabled={submitting} className="rounded-md bg-shell-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-shell-500 disabled:opacity-50">{submitting ? "Advancing..." : "Confirm"}</button>
            <button
              onClick={handleDismiss}
              disabled={dismissing}
              className="rounded-md border border-white/6 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary disabled:opacity-50"
            >
              {dismissing ? "Ignoring..." : "Ignore"}
            </button>
          </div>
          <button
            onClick={() => setShowHintInput(!showHintInput)}
            className="text-[11px] text-text-muted hover:text-text-secondary transition-colors"
          >
            {showHintInput ? "收起" : "添加推进说明..."}
          </button>
        </div>
      </div>

      {showHintInput && (
        <textarea
          value={userHint}
          onChange={(e) => setUserHint(e.target.value)}
          placeholder="可选：填写推进原因或对新阶段的指示..."
          rows={3}
          maxLength={2000}
          className="w-full rounded-md border border-white/6 bg-surface-0 px-2.5 py-1.5 text-xs text-text-primary focus:border-shell-600/40 focus:outline-none resize-none"
        />
      )}
    </div>
    {blockedReasons && (
      <ForceAdvanceDialog
        open={!!blockedReasons}
        onClose={() => setBlockedReasons(null)}
        onConfirmed={(stage) => { onAccepted(stage); refetch(); setBlockedReasons(null); setUserHint(""); setShowHintInput(false); }}
        stageId={stageId}
        targetKey={suggestion.target_key}
        reasons={blockedReasons}
        userHint={userHint.trim() || undefined}
      />
    )}
    </>
  );
}
