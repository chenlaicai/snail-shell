import { QueryClient } from "@tanstack/react-query";
import { showToast } from "../components/Toast";
import { ApiError } from "../services/api-client";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  },
});

// 全局查询错误处理——保持与原 useEffect + showToast 一致的用户体验
// 使用 errorUpdatedAt 去重，避免 refetch 时重复弹 toast
const recentErrors = new Map<string, number>();

// 定期清理过期条目，防止内存泄漏
const CLEANUP_INTERVAL = 60_000;
const MAX_ERROR_AGE = 120_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of recentErrors) {
    if (now - timestamp > MAX_ERROR_AGE) recentErrors.delete(key);
  }
}, CLEANUP_INTERVAL);

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
