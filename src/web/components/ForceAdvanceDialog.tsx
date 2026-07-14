import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { api } from "@/services/api-client";
import { showToast } from "@/components/Toast";
import type { StageDetailDto } from "@/types";

interface ForceAdvanceDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirmed: (stage: StageDetailDto) => void;
  stageId: string;
  targetKey: string;
  /** 409 响应中的 evaluation reasons */
  reasons: Array<{ code: string; severity: string; message: string; details?: Record<string, unknown> }>;
  /** 用户填写的推进说明，传递给强制推进 API */
  userHint?: string;
}

/** 按 severity 分组展示阻断原因 */
function groupBySeverity(reasons: ForceAdvanceDialogProps["reasons"]): { errors: typeof reasons; warnings: typeof reasons } {
  const errors = reasons.filter(r => r.severity === "error");
  const warnings = reasons.filter(r => r.severity !== "error");
  return { errors, warnings };
}

/** 用户强制推进确认对话框：按 severity 分组展示阻断原因，用户确认后调用 /force 端点 */
export function ForceAdvanceDialog({ open, onClose, onConfirmed, stageId, targetKey, reasons, userHint }: ForceAdvanceDialogProps) {
  const [forcing, setForcing] = useState(false);
  const [hintInput, setHintInput] = useState(userHint ?? "");
  const { errors, warnings } = groupBySeverity(reasons);

  function handleClose() {
    if (!forcing) onClose();
  }

  async function handleForceAdvance() {
    setForcing(true);
    try {
      const stage = await api("POST /api/stages/:stageId/advance/force", {
        params: { stageId },
        body: { target_key: targetKey, user_hint: hintInput.trim() || undefined },
      });
      showToast("已强制推进（绕过质量门禁）");
      onConfirmed(stage);
      onClose();
    } catch (err: unknown) {
      showToast(`强制推进失败：${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setForcing(false);
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} title="推进被阻断">
      <div className="space-y-3 mb-4">
        <p className="text-sm text-text-secondary">
          以下原因导致推进被阻断。确认后可强制推进（将记录审计日志）。
        </p>

        {errors.length > 0 && (
          <div>
            <div className="text-xs font-medium text-status-red mb-1.5">错误（必须处理）</div>
            <ul className="space-y-1">
              {errors.map((r, i) => (
                <li key={i} className="text-xs text-text-secondary pl-3 relative before:content-[''] before:absolute before:left-0 before:top-[7px] before:w-1.5 before:h-1.5 before:rounded-full before:bg-status-red">
                  {r.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {warnings.length > 0 && (
          <div>
            <div className="text-xs font-medium text-amber-400 mb-1.5">警告</div>
            <ul className="space-y-1">
              {warnings.map((r, i) => (
                <li key={i} className="text-xs text-text-secondary pl-3 relative before:content-[''] before:absolute before:left-0 before:top-[7px] before:w-1.5 before:h-1.5 before:rounded-full before:bg-amber-400">
                  {r.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <textarea
        value={hintInput}
        onChange={(e) => setHintInput(e.target.value)}
        placeholder="可选：填写强制推进的原因或对新阶段的指示..."
        rows={3}
        maxLength={2000}
        className="w-full rounded-md border border-white/6 bg-surface-0 px-2.5 py-1.5 text-xs text-text-primary focus:border-shell-600/40 focus:outline-none resize-none mb-4"
      />

      <div className="flex justify-end gap-2">
        <button
          data-autofocus
          onClick={handleClose}
          disabled={forcing}
          className="px-4 py-1.5 rounded-md text-sm font-medium text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
        >
          取消
        </button>
        <button
          onClick={handleForceAdvance}
          disabled={forcing}
          className="px-4 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-black text-sm font-medium transition-colors disabled:opacity-50"
        >
          {forcing ? "推进中..." : "确认强制推进"}
        </button>
      </div>
    </Dialog>
  );
}
