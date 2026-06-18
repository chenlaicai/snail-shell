import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/services/api-client";
import { showToast } from "@/components/Toast";
import type { StageDetailDto, StageSuggestion } from "@/types";

export function StageSuggestionCard({
  stageId,
  onAccepted,
}: {
  stageId: string | null;
  onAccepted: (stage: StageDetailDto) => void;
}) {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { data: suggestions = [], refetch } = useQuery({
    queryKey: ["stages", stageId, "transition-suggestions"],
    queryFn: () => api("GET /api/stages/:stageId/transition-suggestions", { params: { stageId: stageId! } }),
    enabled: !!stageId,
  });

  const suggestion = (suggestions as StageSuggestion[]).find((item) => `${item.stage_id}:${item.target_key}:${item.created_at}` !== dismissedKey) ?? null;
  if (!stageId || !suggestion) return null;

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
      showToast(`推进失败：${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setSubmitting(false);
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
        </div>
        <div className="flex shrink-0 gap-2">
          <button onClick={handleConfirm} disabled={submitting} className="rounded-md bg-shell-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-shell-500 disabled:opacity-50">{submitting ? "Advancing..." : "Confirm"}</button>
          <button
            onClick={() => setDismissedKey(`${suggestion.stage_id}:${suggestion.target_key}:${suggestion.created_at}`)}
            className="rounded-md border border-white/6 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
          >
            Ignore
          </button>
        </div>
      </div>
    </div>
  );
}
