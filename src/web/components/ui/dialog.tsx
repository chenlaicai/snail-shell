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
      className="m-auto w-[min(640px,calc(100vw-32px))] max-w-[640px] rounded-lg border border-white/6 bg-surface-1 p-0 text-text-primary shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop:bg-black/60"
    >
      <div className="flex max-h-[calc(100vh-48px)] flex-col overflow-hidden">
        <div className="border-b border-white/6 px-4 py-3">
          <h3 id={titleId} className="m-0 text-sm font-semibold">{title}</h3>
        </div>
        <div className="overflow-y-auto px-4 py-4">
          {children}
        </div>
      </div>
    </dialog>
  );
}
