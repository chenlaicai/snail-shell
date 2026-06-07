import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { WorkspaceTree } from "../components/Sidebar/WorkspaceTree";
import { ContextPanel } from "../components/ContextPanel";
import { api } from "../services/api-client";

import { Button } from "@/components/ui/button";
import type { WorkspaceSummary, Issue } from "../types";

const NAV_ITEMS = [
  { path: "/", label: "Workspaces" },
  { path: "/evolution", label: "Evolution Center" },
  { path: "/knowledge", label: "知识库" },
  { path: "/sops", label: "SOP" },
  { path: "/snail-den", label: "Snail Den" },
  { path: "/prompts", label: "Prompt Center" },
  { path: "/skills", label: "Skill Center" },
  { path: "/mcps", label: "MCPs" },
  { path: "/lobby", label: "IM 大厅" },
];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [issue, setIssue] = useState<Issue | null>(null);
  const path = location.pathname;

  // Load workspace/issue data for context panel
  const wsMatch = path.match(/^\/ws\/([^/]+)/);
  const issueMatch = path.match(/^\/ws\/[^/]+\/issue\/([^/]+)/);
  const workspaceId = wsMatch?.[1];
  const issueId = issueMatch?.[1];

  useEffect(() => {
    if (!workspaceId) { setWorkspace(null); setIssue(null); return; }
    api("GET /api/workspaces/:workspaceId", { params: { workspaceId } }).then(setWorkspace).catch(() => setWorkspace(null));
  }, [workspaceId]);

  useEffect(() => {
    if (!issueId) { setIssue(null); return; }
    api("GET /api/issues/:issueId", { params: { issueId } }).then(setIssue).catch(() => setIssue(null));
  }, [issueId]);

  const currentView = path === "/" ? "workspaces" : path.split("/")[1] || "workspaces";
  const isBoard = /^\/ws\/[^/]+$/.test(path);
  const isConversation = /^\/ws\/[^/]+\/issue\/[^/]+$/.test(path);
  const dataWorkspaceView = isConversation ? "conversation" : isBoard ? "board" : undefined;

  function isActive(navPath: string) {
    if (navPath === "/") return path.startsWith("/ws");
    return path.startsWith(navPath);
  }

  async function handleNav(navPath: string) {
    // Workspaces 按钮跳转到第一个工作区
    if (navPath === "/") {
      try {
        const workspaces = await api("GET /api/workspaces");
        if (workspaces.length > 0) {
          navigate(`/ws/${workspaces[0].id}`);
        } else {
          navigate("/");
        }
      } catch {
        navigate("/");
      }
    } else {
      navigate(navPath);
    }
    setSidebarExpanded(false);
  }

  // Escape 关闭侧栏
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && sidebarExpanded) {
      setSidebarExpanded(false);
      e.stopPropagation();
    }
  }, [sidebarExpanded]);

  useEffect(() => {
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [handleEscape]);

  // 响应式布局检测
  const [layout, setLayout] = useState<"full" | "medium" | "narrow" | "compact">("full");
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const w = document.documentElement.clientWidth;
      if (w >= 1200) setLayout("full");
      else if (w >= 900) setLayout("medium");
      else if (w >= 600) setLayout("narrow");
      else setLayout("compact");
    });
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div id="app-notice" className="hidden" />
      <div className="flex h-screen min-h-0 bg-[var(--color-bg-base)]" data-primary-view={currentView} data-workspace-view={dataWorkspaceView} data-layout={layout}>
        {/* LEFT SIDEBAR */}
        <aside className={`flex flex-col w-[var(--sidebar-width)] shrink-0 bg-[var(--color-bg-surface)] border-r border-[var(--color-border-muted)] overflow-hidden transition-[width] duration-200 ${layout === "compact" ? (sidebarExpanded ? "fixed inset-0 z-50 w-screen" : "w-0") : ""}`}>
          <header className="flex items-center gap-[var(--space-sm)] p-[var(--space-md)] border-b border-[var(--color-border-muted)]">
            <div className="w-7 h-7 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-background)] font-bold text-sm flex items-center justify-center">S</div>
            <div className="text-sm font-semibold text-[var(--color-text-primary)]"><span className="text-[var(--color-accent)]">Snail</span> Shell</div>
          </header>

          {(layout === "compact" || layout === "narrow") && (
            <button className="p-[var(--space-sm)] text-[var(--color-text-muted)]" type="button" aria-label="Toggle navigation" onClick={() => setSidebarExpanded(!sidebarExpanded)}>
              ☰
            </button>
          )}
          {sidebarExpanded && (layout === "compact" || layout === "narrow") && <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setSidebarExpanded(false)} />}

          <section className="flex flex-col min-h-0">
            <button className="flex items-center justify-between px-[var(--space-md)] py-[var(--space-sm)] text-[var(--color-text-muted)] text-xs" type="button">
              <span className="font-semibold text-[var(--color-text-secondary)]">导航</span>
              <span className="text-[10px]">▴</span>
            </button>
            <div className="flex flex-col gap-px px-[var(--space-xs)]">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.path}
                  className={`px-[var(--space-md)] py-[var(--space-xs)] rounded-[var(--radius-sm)] text-[12px] text-left transition-colors ${
                    isActive(item.path)
                      ? "bg-[var(--color-bg-active)] text-[var(--color-accent)] font-semibold"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)]"
                  }`}
                  aria-current={isActive(item.path) ? "page" : undefined}
                  onClick={() => handleNav(item.path)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <div className="flex-1 min-h-0 overflow-auto">
            {renderSidebarContent(path, navigate)}
          </div>
        </aside>

        {/* MAIN PANEL */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <Outlet />
        </main>

        {/* CONTEXT PANEL — 只在对话页显示 */}
        {isConversation && (
          <aside className="w-[var(--context-panel-width)] shrink-0 bg-[var(--color-bg-surface)] border-l border-[var(--color-border-muted)] overflow-auto">
            <ContextPanel workspace={workspace} issue={issue} />
          </aside>
        )}
      </div>
    </>
  );
}

function renderSidebarContent(path: string, navigate: (path: string) => void) {
  // 工作区路由显示工作区树（首页不显示）
  if (path.startsWith("/ws")) {
    return (
      <div className="flex flex-col min-h-0" data-view-related="workspaces">
        <div id="workspace-summary-card" hidden />
        <div className="flex items-center justify-between px-[var(--space-md)] py-[var(--space-sm)]">
          <div className="text-xs font-semibold text-[var(--color-text-muted)]">Workspaces</div>
          <Button size="sm" onClick={() => navigate("/ws/new")}>新建</Button>
        </div>
        <section className="flex-1 min-h-0 overflow-auto px-[var(--space-sm)]">
          <WorkspaceTree />
        </section>
      </div>
    );
  }

  // 演进中心
  if (path === "/evolution") {
    return (
      <div className="flex flex-col min-h-0" data-view-related="evolution">
        <div className="px-[var(--space-md)] py-[var(--space-sm)]">
          <div className="text-xs font-semibold text-[var(--color-text-muted)]">Evolution Directory</div>
        </div>
        <section className="flex-1 min-h-0 overflow-auto px-[var(--space-sm)]">
          <div className="p-[var(--space-md)] text-[var(--color-text-muted)] text-[var(--font-size-sm)]">
            演进工作区、治理进度和已沉淀知识
          </div>
        </section>
      </div>
    );
  }

  // 其他管理页面只显示主导航
  return null;
}
