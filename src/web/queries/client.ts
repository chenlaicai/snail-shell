import { QueryClient } from "@tanstack/react-query";
import { showToast } from "../components/Toast";

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
queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== "updated" || event.query.state.status !== "error") return;
  const err = event.query.state.error;
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg || msg.includes("Not found")) return;
  const key = event.query.queryHash;
  const lastError = recentErrors.get(key);
  const now = event.query.state.errorUpdatedAt;
  if (lastError === now) return; // 同一次错误，跳过
  recentErrors.set(key, now);
  showToast(`加载失败：${msg}`, true);
});
