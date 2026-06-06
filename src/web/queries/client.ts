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
queryClient.getQueryCache().subscribe((event) => {
  if (event.type === "updated" && event.query.state.status === "error") {
    const err = event.query.state.error;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg && !msg.includes("Not found")) {
      showToast(`加载失败：${msg}`, true);
    }
  }
});
