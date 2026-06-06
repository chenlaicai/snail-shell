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
      style={{
        borderRadius: 8,
        border: "1px solid var(--color-border, #1e293b)",
        background: "var(--color-bg-card, #111827)",
        color: "var(--color-text-primary, #f1f5f9)",
        padding: 0,
        maxWidth: 420,
        width: "90vw",
      }}
    >
      <div style={{ padding: "var(--space-lg, 16px)" }}>
        <h3 style={{ margin: "0 0 var(--space-md, 12px)", fontSize: "var(--font-size-md, 14px)" }}>{title}</h3>
        {children}
      </div>
    </dialog>
  );
}
