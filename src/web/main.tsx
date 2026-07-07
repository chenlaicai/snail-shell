import "./globals.css";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { RouterProvider } from "react-router-dom";
import { queryClient } from "./queries/client";
import { router } from "./router";
import { Toast } from "./components/Toast";
import { initNavTraceOnPageLoad } from "./lib/nav-trace";

// 在 React 渲染前检测导航类型，确保 HTTP 全量刷新时能捕获 trace buffer
initNavTraceOnPageLoad();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toast />
      <RouterProvider router={router} />
      <ReactQueryDevtools />
    </QueryClientProvider>
  );
}

const root = createRoot(document.getElementById("app-root")!);
root.render(<App />);
