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
      requestAnimationFrame(() => {
        const autofocus = el.querySelector<HTMLElement>("[data-autofocus]");
        const target = autofocus ?? el.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        target?.focus();
      });
    }
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      aria-labelledby={titleId}
      className="m-auto max-w-[640px] w-[min(640px,calc(100vw-32px))] rounded-[var(--radius-lg)] border border-[var(--color-border-muted)] bg-[var(--color-bg-card)] p-0 text-[var(--color-text-primary)] shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop:bg-black/60"
    >
      <div className="flex max-h-[calc(100vh-48px)] flex-col overflow-hidden">
        <div className="border-b border-[var(--color-border-muted)] px-[var(--space-lg)] py-[var(--space-md)]">
          <h3 id={titleId} className="m-0 text-[var(--font-size-md)] font-semibold">{title}</h3>
        </div>
        <div className="overflow-y-auto px-[var(--space-lg)] py-[var(--space-lg)]">
          {children}
        </div>
      </div>
    </dialog>
  );
}
