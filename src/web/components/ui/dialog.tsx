import { useRef, useEffect, type ReactNode } from "react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Dialog({ open, onClose, title, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-primary)] p-0 max-w-[420px] w-[90vw] backdrop:bg-black/50"
    >
      <div className="p-[var(--space-lg)]">
        <h3 className="m-0 mb-[var(--space-md)] text-[var(--font-size-md)]">{title}</h3>
        {children}
      </div>
    </dialog>
  );
}
