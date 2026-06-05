import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { queryClient } from "./queries/client";
import { router } from "./router";
import { Toast } from "./components/Toast";

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toast />
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const root = createRoot(document.getElementById("app-root")!);
root.render(<App />);
