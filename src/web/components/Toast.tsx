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
    <div id="app-notice" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000 }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            padding: "10px 20px",
            background: t.isError ? "var(--color-danger-bg)" : "var(--color-info-bg)",
            color: t.isError ? "var(--color-danger-text)" : "var(--color-info-text)",
            fontSize: "13px",
            borderBottom: "1px solid var(--color-border-muted)",
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
