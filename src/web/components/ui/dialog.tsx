import { useRef, useEffect, useId, type ReactNode } from "react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Dialog({ open, onClose, title, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // 焦点移到 dialog 内第一个可聚焦元素
      const firstFocusable = el.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      firstFocusable?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  // Escape 关闭由原生 <dialog> 处理，onClose 通过 close 事件触发
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      aria-labelledby={titleId}
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-primary)] p-0 max-w-[420px] w-[90vw] backdrop:bg-black/50"
    >
      <div className="p-[var(--space-lg)]">
        <h3 id={titleId} className="m-0 mb-[var(--space-md)] text-[var(--font-size-md)]">{title}</h3>
        {children}
      </div>
    </dialog>
  );
}
