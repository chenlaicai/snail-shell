import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, BlockedError } from "@/services/api-client";
import { showToast } from "@/components/Toast";
import type { StageDetailDto, StageSuggestion } from "@/types";

/** 信号类型中文映射 */
const SIGNAL_TYPE_LABEL: Record<string, string> = {
  gate_complete: "单人完成",
  adversarial_consensus: "对抗共识",
  disagreement: "分歧",
};

/** 从 gate_evidence 中提取摘要：前 3 条 + 总数 */
function getGateEvidenceSummary(gateEvidence: Record<string, unknown> | undefined): { items: [string, unknown][]; total: number } {
  if (!gateEvidence || typeof gateEvidence !== "object") return { items: [], total: 0 };
  const entries = Object.entries(gateEvidence);
  return { items: entries.slice(0, 3), total: entries.length };
}

export function StageSuggestionCard({
  stageId,
  onAccepted,
}: {
  stageId: string | null;
  onAccepted: (stage: StageDetailDto) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const { data: suggestions = [], refetch } = useQuery({
    queryKey: ["stages", stageId, "transition-suggestions"],
    queryFn: () => api("GET /api/stages/:stageId/transition-suggestions", { params: { stageId: stageId! } }),
    enabled: !!stageId,
  });

  const suggestion = (suggestions as StageSuggestion[])[0] ?? null;
  if (!stageId || !suggestion) return null;

  const signalType = suggestion.signal_type;
  const gateSummary = getGateEvidenceSummary(suggestion.gate_evidence);

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const stage = await api("POST /api/stages/:stageId/advance", {
        params: { stageId },
        body: { target_key: suggestion.target_key },
      });
      showToast("阶段已推进");
      onAccepted(stage);
      refetch();
    } catch (err: unknown) {
      if (err instanceof BlockedError && err.evaluation.reasons.length > 0) {
        const details = err.evaluation.reasons.map((r) => r.message).join("\n");
        showToast(`推进被阻断：\n${details}`, true);
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
    } catch (err: unknown) {
      showToast(`忽略失败：${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setDismissing(false);
    }
  }

  return (
    <div className="rounded-lg border border-shell-600/30 bg-shell-600/10 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-shell-400">Stage Suggestion</div>
          <div className="mt-1 text-[12px] leading-5 text-text-secondary">
            AI 建议由 <span className="text-text-primary">{suggestion.from_speaker}</span> 推进到 <span className="text-text-primary">{suggestion.target_key}</span>
            {suggestion.reason && `：${suggestion.reason}`}
          </div>

          {/* Gate Evidence 摘要 */}
          {gateSummary.items.length > 0 && (
            <div className="mt-2 text-[11px] leading-4 text-text-secondary">
              <span className="text-green-400">✅ Gate 通过：</span>
              {gateSummary.items.map(([key, value]) => (
                <div key={key} className="ml-3">
                  - {key}: <span className="text-text-primary">{typeof value === "string" ? value : String(value)}</span>
                </div>
              ))}
              {gateSummary.total > 3 && <div className="ml-3 text-text-secondary/60">...共 {gateSummary.total} 项</div>}
            </div>
          )}

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

          {/* Details 展开区域 */}
          {showDetails && (
            <div className="mt-2 rounded border border-white/5 bg-shell-600/5 p-2 text-[11px] leading-4">
              {/* 完整 gate_evidence */}
              {suggestion.gate_evidence && (
                <div className="mb-2">
                  <div className="font-medium text-shell-400">完整 Gate Evidence</div>
                  {Object.entries(suggestion.gate_evidence).map(([key, value]) => (
                    <div key={key} className="ml-2 text-text-secondary">
                      {key}: <span className="text-text-primary">{typeof value === "string" ? value : JSON.stringify(value)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 对抗产物摘要 */}
              {suggestion.adversarial_artifact && typeof suggestion.adversarial_artifact === "object" && (
                <div>
                  <div className="font-medium text-shell-400">对抗产物摘要</div>
                  {(() => {
                    const artifact = suggestion.adversarial_artifact as Record<string, unknown>;
                    const iv = artifact.independent_verification;
                    const af = artifact.adversarial_findings;
                    return (
                      <>
                        {Array.isArray(iv) && iv.length > 0 && (
                          <div className="ml-2 text-text-secondary">
                            独立验证：{typeof iv[0] === "object" && iv[0] !== null ? String((iv[0] as Record<string, unknown>).actual_output ?? "").slice(0, 100) : String(iv[0]).slice(0, 100)}
                            {(String((iv[0] as Record<string, unknown>).actual_output ?? "").length > 100) && "..."}
                          </div>
                        )}
                        {Array.isArray(af) && (
                          <div className="ml-2 text-text-secondary">
                            发现项：{af.length} 条，已解决 {af.filter((f: Record<string, unknown>) => f.disposition && f.disposition !== "none").length} 条
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
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
          {(suggestion.gate_evidence || suggestion.adversarial_artifact) && (
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-[11px] text-shell-400 hover:text-shell-300 transition-colors"
            >
              {showDetails ? "收起" : "Details..."}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
