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
    <div className="pointer-events-none fixed right-4 top-4 z-[1000] flex w-[min(420px,calc(100vw-32px))] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto rounded-lg border px-3 py-2 text-xs shadow-[0_16px_40px_rgba(0,0,0,0.35)] backdrop-blur ${
            t.isError
              ? "border-status-red/35 bg-status-red/15 text-status-red"
              : "border-shell-600/35 bg-surface-2/95 text-text-primary"
          }`}
        >
          <div className="font-semibold">{t.isError ? "操作失败" : "操作成功"}</div>
          <div className="mt-0.5 text-[11px] opacity-85">{t.message}</div>
        </div>
      ))}
    </div>
  );
}
