import { QueryClient } from "@tanstack/react-query";
import { showToast } from "../components/Toast";
import { ApiError } from "../services/api-client";
import { recordQueryTiming, recordQueryError } from "../lib/perf-logger";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

// 全局查询错误处理——保持与原 useEffect + showToast 一致的用户体验
// 使用 errorUpdatedAt 去重，避免 refetch 时重复弹 toast
const recentErrors = new Map<string, number>();

// 定期清理过期条目 + 最大条目限制，防止内存泄漏
// globalThis 防止 Vite HMR 场景下累积多个 interval
const CLEANUP_INTERVAL = 60_000;
const MAX_ERROR_AGE = 120_000;
const MAX_ERROR_ENTRIES = 200;
const g = globalThis as Record<string, unknown>;
if (!g.__snail_error_cleanup) {
  g.__snail_error_cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of recentErrors) {
      if (now - timestamp > MAX_ERROR_AGE) recentErrors.delete(key);
    }
    // 超出上限时删除最旧条目
    if (recentErrors.size > MAX_ERROR_ENTRIES) {
      const sorted = [...recentErrors.entries()].sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < sorted.length - MAX_ERROR_ENTRIES; i++) {
        recentErrors.delete(sorted[i][0]);
      }
    }
    // 清理超时的 query 计时（防止泄漏）
    for (const [hash, startTime] of queryStartTimes) {
      if (now - startTime > 60_000) queryStartTimes.delete(hash);
    }
  }, CLEANUP_INTERVAL);
}

queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== "updated" || event.query.state.status !== "error") return;
  const err = event.query.state.error;
  // 跳过 404 错误（资源不存在是正常业务状态，不需要 toast）
  if (err instanceof ApiError && err.status === 404) return;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (!msg) return;
  const key = event.query.queryHash;
  const lastError = recentErrors.get(key);
  const now = event.query.state.errorUpdatedAt;
  if (lastError === now) return; // 同一次错误，跳过
  recentErrors.set(key, now);
  showToast(`加载失败：${msg}`, true);
});

// Query 耗时追踪：记录开始时间，完成时计算耗时
const queryStartTimes = new Map<string, number>();

queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== "updated") return;
  const { query } = event;
  const hash = query.queryHash;

  // 进入 fetching 状态 → 记录开始时间
  if (query.state.status === "fetching" && !queryStartTimes.has(hash)) {
    queryStartTimes.set(hash, performance.now());
    return;
  }

  // fetching 结束（success 或 error）→ 计算耗时
  const startTime = queryStartTimes.get(hash);
  if (startTime == null) return;
  queryStartTimes.delete(hash);
  const duration = performance.now() - startTime;
  const keyStr = JSON.stringify(query.queryKey);

  if (query.state.status === "error") {
    const errMsg = query.state.error instanceof Error ? query.state.error.message : String(query.state.error);
    recordQueryError(keyStr, errMsg);
  } else {
    recordQueryTiming(keyStr, duration);
  }
});
