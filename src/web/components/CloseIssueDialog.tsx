import { Dialog } from "@/components/ui/dialog";

interface CloseIssueDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** mutation 是否正在进行中，由外部控制 */
  closing: boolean;
}

/** Close Issue 确认弹窗，复用 Dialog 组件替代 window.confirm */
export function CloseIssueDialog({ open, onClose, onConfirm, closing }: CloseIssueDialogProps) {
  function handleConfirm() {
    onConfirm();
  }

  /** closing 时禁止点击遮罩/Escape 关闭 */
  function handleClose() {
    if (!closing) onClose();
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
          disabled={closing}
          className="px-4 py-1.5 rounded-md text-sm font-medium text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={closing}
          className="px-4 py-1.5 rounded-md bg-status-red hover:bg-status-red/80 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {closing ? "Closing..." : "Close Issue"}
        </button>
      </div>
    </Dialog>
  );
}
