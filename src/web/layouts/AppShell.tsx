import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { WorkspaceTree } from "../components/Sidebar/WorkspaceTree";
import { ContextPanel } from "../components/ContextPanel";
import { api } from "../services/api";
import { showToast } from "../components/Toast";
import { Button } from "@/components/ui/button";

interface Workspace {
  id: string;
  name: string;
  kind?: string;
  boss_pending_count?: number;
}

interface Issue {
  id: string;
  title: string;
  closed_at?: string | null;
}

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
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [issue, setIssue] = useState<Issue | null>(null);
  const path = location.pathname;

  // Load workspace/issue data for context panel
  const wsMatch = path.match(/^\/ws\/([^/]+)/);
  const issueMatch = path.match(/^\/ws\/[^/]+\/issue\/([^/]+)/);
  const workspaceId = wsMatch?.[1];
  const issueId = issueMatch?.[1];

  useEffect(() => {
    if (!workspaceId) { setWorkspace(null); setIssue(null); return; }
    api("GET", `/workspaces/${workspaceId}`).then(setWorkspace).catch(() => setWorkspace(null));
  }, [workspaceId]);

  useEffect(() => {
    if (!issueId) { setIssue(null); return; }
    api("GET", `/issues/${issueId}`).then(setIssue).catch(() => setIssue(null));
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
        const workspaces = await api("GET", "/workspaces");
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
      <div className="app-shell" data-primary-view={currentView} data-workspace-view={dataWorkspaceView} data-layout={layout}>
        {/* LEFT SIDEBAR */}
        <aside className="sidebar">
          <header className="brand-bar">
            <div className="brand-mark">S</div>
            <div className="brand-title"><span>Snail</span> Shell</div>
          </header>

          <button className="sidebar-toggle" type="button" aria-label="Toggle navigation" onClick={() => setSidebarExpanded(!sidebar-expanded)}>
            ☰
          </button>
          <div className="sidebar-backdrop" onClick={() => setSidebarExpanded(false)} />

          <section className="directory-switcher" id="directory-switcher">
            <button className="directory-summary" type="button" onClick={() => document.getElementById("directory-switcher")?.classList.toggle("is-collapsed")}>
              <span><span className="directory-title">导航</span></span>
              <span className="directory-chevron">▴</span>
            </button>
            <div className="primary-nav" id="primary-nav">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.path}
                  className={`primary-nav-button${isActive(item.path) ? " active" : ""}`}
                  aria-current={isActive(item.path) ? "page" : undefined}
                  onClick={() => handleNav(item.path)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <div className="sidebar-main">
            {renderSidebarContent(path, navigate)}
          </div>
        </aside>

        {/* MAIN PANEL */}
        <main className="main-panel">
          <div className="boss-mentions-banner" id="boss-mentions-banner" />
          <Outlet />
        </main>

        {/* CONTEXT PANEL — 只在对话页显示 */}
        {isConversation && (
          <aside className="context-panel view-related" data-view-related={currentView}>
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
      <div className="view-related workspace-tree" data-view-related="workspaces">
        <div id="workspace-summary-card" hidden />
        <div className="tree-toolbar">
          <div className="panel-title">Workspaces</div>
          <div className="button-row">
            <Button size="sm" onClick={() => navigate("/ws/new")}>新建</Button>
          </div>
        </div>
        <section className="tree-card">
          <div className="tree-workspace-list">
            <WorkspaceTree />
          </div>
        </section>
      </div>
    );
  }

  // 演进中心
  if (path === "/evolution") {
    return (
      <div className="view-related workspace-tree" data-view-related="evolution">
        <div className="tree-toolbar">
          <div className="panel-title">Evolution Directory</div>
        </div>
        <section className="tree-card">
          <div className="empty-state" style={{ padding: "var(--space-md)" }}>
            演进工作区、治理进度和已沉淀知识
          </div>
        </section>
      </div>
    );
  }

  // 其他管理页面只显示主导航
  return null;
}
