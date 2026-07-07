/**
 * Navigation Trace Buffer — 导航生命周期可观测性。
 *
 * sessionStorage ring buffer 记录导航/close/WS/batcher 事件。
 * HTTP 全量刷新后 buffer 存活，页面加载时检测导航类型并自动 dump + 上报。
 *
 * 语义不变量：埋点不改变任何现有业务行为，写入失败静默跳过。
 */

interface NavTraceEntry {
  ts: number;
  type: string;
  detail?: unknown;
}

const STORAGE_KEY = "nav-trace-buffer";
const MAX_ENTRIES = 100;

/** 是否已初始化 pagehide 监听器 */
let pagehideInitialized = false;

/** wsStatus 提供器——由 useWebSocket 注册 */
let wsStatusProvider: (() => string) | null = null;

/** pending mutation 提供器——由 issue.mutations 注册 */
let pendingMutationProvider: (() => boolean) | null = null;

function readBuffer(): NavTraceEntry[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as NavTraceEntry[] : [];
  } catch {
    return [];
  }
}

function writeBuffer(entries: NavTraceEntry[]): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // sessionStorage 不可用时静默跳过
  }
}

/** 向 ring buffer 追加一条 trace 记录 */
export function navTrace(type: string, detail?: unknown): void {
  const entry: NavTraceEntry = { ts: Date.now(), type, detail };
  const entries = readBuffer();
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  writeBuffer(entries);
}

/** 注册 WebSocket 状态提供器，供 pagehide 快照使用 */
export function registerWsStatusProvider(fn: () => string): void {
  wsStatusProvider = fn;
}

/** 注册 pending mutation 提供器，供 pagehide 快照使用 */
export function registerPendingMutationProvider(fn: () => boolean): void {
  pendingMutationProvider = fn;
}

/** 获取当前 trace buffer（用于 dump） */
export function getTraceBuffer(): NavTraceEntry[] {
  return readBuffer();
}

/** 清除 trace buffer（dump 后调用） */
export function clearTraceBuffer(): void {
  writeBuffer([]);
}

/** 从 trace entry 中提取 URL——用于 page_load 的 prevUrl 诊断 */
function extractUrlFromEntry(entry: NavTraceEntry | undefined): string | undefined {
  if (!entry?.detail) return undefined;
  const d = entry.detail as Record<string, unknown>;
  switch (entry.type) {
    case "pagehide": return typeof d.url === "string" ? d.url : undefined;
    case "navigate": return typeof d.to === "string" ? d.to : undefined;
    default: return undefined;
  }
}

/**
 * 页面加载时检测导航类型。
 * 必须在 main.tsx 入口、React 渲染前调用。
 */
export function initNavTraceOnPageLoad(): void {
  const entries = readBuffer();

  let navType = "unknown";
  try {
    const navEntries = performance.getEntriesByType("navigation");
    if (navEntries.length > 0) {
      navType = (navEntries[0] as PerformanceNavigationTiming).type;
    }
  } catch {
    // 不支持 performance.getEntriesByType 时静默跳过
  }

  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : undefined;
  const prevUrl = extractUrlFromEntry(lastEntry);

  navTrace("page_load", { navType, prevUrl: prevUrl ?? undefined });

  if (navType === "navigate" || navType === "reload") {
    // HTTP 全量刷新发生——dump trace buffer
    const buffer = readBuffer();
    // eslint-disable-next-line no-console
    console.warn("[NavTrace] HTTP full reload detected. Trace buffer:", buffer);

    // 通过 sendBeacon 上报到 /api/frontend-log（适配 PerfEntry schema）
    try {
      const payload = {
        logs: [{
          level: "warn" as const,
          type: "nav_trace_dump",
          metric: "http_reload",
          reason: JSON.stringify(buffer),
          ts: Date.now(),
        }],
      };
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      navigator.sendBeacon("/api/frontend-log", blob);
    } catch {
      // sendBeacon 不可用时静默跳过
    }
  } else {
    // eslint-disable-next-line no-console
    console.debug("[NavTrace] SPA navigation detected.", { navType });
  }

  initPagehideHandler();
}

/** 注册 pagehide 事件——在页面卸载前同步写入状态快照 */
function initPagehideHandler(): void {
  if (pagehideInitialized) return;
  pagehideInitialized = true;

  window.addEventListener("pagehide", () => {
    navTrace("pagehide", {
      url: location.href,
      wsStatus: wsStatusProvider?.() ?? "unknown",
      hasPendingMutation: pendingMutationProvider?.() ?? false,
    });
  });
}
