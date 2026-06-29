/**
 * 前端性能日志采集器。
 *
 * 在关键路径上记录耗时，超阈值自动批量上报到 POST /api/frontend-log。
 * 阈值：API 请求 > 1s、页面加载 > 3s、WebSocket 重连 > 5s、Query 耗时 > 2s。
 */

interface PerfEntry {
  level: "info" | "warn" | "error";
  type: string;
  metric: string;
  url?: string;
  duration?: number;
  reason?: string;
  ts: number;
}

const API_THRESHOLD = 1_000;
const PAGE_LOAD_THRESHOLD = 3_000;
const WS_RECONNECT_THRESHOLD = 5_000;
const QUERY_THRESHOLD = 2_000;

/** 待上报队列 + 防抖定时器 */
let pending: PerfEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL = 3_000;

function enqueue(entry: PerfEntry): void {
  pending.push(entry);
  if (!flushTimer) {
    flushTimer = setTimeout(flush, FLUSH_INTERVAL);
  }
}

/** 页面关闭前把残留日志同步发出去 */
function handleBeforeUnload(): void {
  if (pending.length === 0) return;
  const blob = new Blob([JSON.stringify({ logs: pending })], { type: "application/json" });
  navigator.sendBeacon("/api/frontend-log", blob);
  pending = [];
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", handleBeforeUnload);
}

async function flush(): Promise<void> {
  flushTimer = null;
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];
  try {
    await fetch("/api/frontend-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logs: batch }),
    });
  } catch {
    // 上报失败不重试，避免日志风暴
  }
}

/** 记录 API 请求耗时（前端视角） */
export function recordApiTiming(method: string, url: string, duration: number): void {
  if (duration < API_THRESHOLD) return;
  enqueue({ level: "warn", type: "frontend.perf", metric: "api_request", url: `${method} ${url}`, duration, ts: Date.now() });
}

/** 记录页面加载耗时（路由 loader + 水合） */
export function recordPageLoad(path: string, duration: number): void {
  if (duration < PAGE_LOAD_THRESHOLD) return;
  enqueue({ level: "warn", type: "frontend.perf", metric: "page_load", url: path, duration, ts: Date.now() });
}

/** 记录 WebSocket 重连耗时 */
export function recordWsReconnect(duration: number, attempt: number): void {
  if (duration < WS_RECONNECT_THRESHOLD) return;
  enqueue({ level: "warn", type: "frontend.perf", metric: "ws_reconnect", duration, reason: `attempt=${attempt}`, ts: Date.now() });
}

/** 记录 WebSocket 连接失败 */
export function recordWsDisconnect(reason: string): void {
  enqueue({ level: "info", type: "frontend.ws", metric: "ws_disconnect", reason, ts: Date.now() });
}

/** 记录 React Query 耗时 */
export function recordQueryTiming(queryKey: string, duration: number): void {
  if (duration < QUERY_THRESHOLD) return;
  enqueue({ level: "warn", type: "frontend.perf", metric: "query", url: queryKey, duration, ts: Date.now() });
}

/** 记录 React Query 失败 */
export function recordQueryError(queryKey: string, reason: string): void {
  enqueue({ level: "error", type: "frontend.error", metric: "query_error", url: queryKey, reason, ts: Date.now() });
}
