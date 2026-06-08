import { useEffect, useState } from "react";

interface ToastMessage {
  id: number;
  message: string;
  isError: boolean;
}

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
    <div className="fixed top-0 left-0 right-0 z-[1000]">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-5 py-2.5 text-[13px] border-b border-[var(--color-border-muted)] ${
            t.isError
              ? "bg-[var(--color-bg-danger)] text-[var(--color-danger-text)]"
              : "bg-[var(--color-bg-info)] text-[var(--color-info-text)]"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
