import { Outlet } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";

export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-surface-0 text-text-primary">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
