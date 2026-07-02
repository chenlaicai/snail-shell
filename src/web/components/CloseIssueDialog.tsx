import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";

interface CloseIssueDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** mutation 是否正在进行中，由外部控制；结束且弹窗仍打开时重置内部 loading */
  closing: boolean;
}

/** Close Issue 确认弹窗，复用 Dialog 组件替代 window.confirm */
export function CloseIssueDialog({ open, onClose, onConfirm, closing }: CloseIssueDialogProps) {
  const [loading, setLoading] = useState(false);

  /** closing 从 true → false 且弹窗仍打开，说明操作失败，重置 loading */
  useEffect(() => {
    if (!closing && loading && open) setLoading(false);
  }, [closing, loading, open]);

  /** open 变为 false 时重置 loading（成功关闭弹窗后清理状态） */
  useEffect(() => {
    if (!open) setLoading(false);
  }, [open]);

  function handleConfirm() {
    setLoading(true);
    onConfirm();
  }

  /** loading 时禁止点击遮罩/Escape 关闭 */
  function handleClose() {
    if (!loading) onClose();
  }

  return (
    <Dialog open={open} onClose={handleClose} title="Close Issue">
      <p className="text-sm text-text-secondary mb-4">
        确认关闭此 Issue？关闭后对话保留为只读
      </p>
      <div className="flex justify-end gap-2">
        <button
          data-autofocus
          onClick={handleClose}
          disabled={loading}
          className="px-4 py-1.5 rounded-md text-sm font-medium text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={loading}
          className="px-4 py-1.5 rounded-md bg-status-red hover:bg-status-red/80 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {loading ? "Closing..." : "Close Issue"}
        </button>
      </div>
    </Dialog>
  );
}
