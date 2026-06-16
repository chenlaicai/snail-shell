import { useEffect, useState } from "react";
import type { ToastMessage } from "../types";

let toastId = 0;
let listeners: ((msg: ToastMessage) => void)[] = [];

export function showToast(message: string, isError = false) {
  const msg: ToastMessage = { id: ++toastId, message, isError };
  listeners.forEach((fn) => fn(msg));
}

export function Toast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const handler = (msg: ToastMessage) => {
      setToasts((prev) => [...prev, msg]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== msg.id));
      }, 2500);
    };
    listeners.push(handler);
    return () => { listeners = listeners.filter((l) => l !== handler); };
  }, []);

  return (
    <div className="pointer-events-none fixed right-[var(--space-lg)] top-[var(--space-lg)] z-[1000] flex w-[min(420px,calc(100vw-32px))] flex-col gap-[var(--space-sm)]">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto rounded-[var(--radius-lg)] border px-[var(--space-md)] py-[var(--space-sm)] text-[var(--font-size-sm)] shadow-[0_16px_40px_rgba(0,0,0,0.35)] backdrop-blur ${
            t.isError
              ? "border-[rgba(248,113,113,0.35)] bg-[rgba(127,29,29,0.92)] text-[var(--color-danger-text)]"
              : "border-[rgba(108,141,250,0.35)] bg-[rgba(15,18,24,0.94)] text-[var(--color-text-primary)]"
          }`}
        >
          <div className="font-semibold">{t.isError ? "操作失败" : "操作成功"}</div>
          <div className="mt-[2px] text-[var(--font-size-xs)] opacity-85">{t.message}</div>
        </div>
      ))}
    </div>
  );
}
