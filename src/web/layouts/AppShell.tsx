import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
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
    if (navPath === "/") return path === "/" || path.startsWith("/ws");
    return path.startsWith(navPath);
  }

  function handleNav(navPath: string) {
    navigate(navPath);
    setSidebarExpanded(false);
  }

  return (
    <>
      <div id="app-notice" className="hidden" />
      <div className="app-shell" data-primary-view={currentView} data-workspace-view={dataWorkspaceView}>
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

        {/* CONTEXT PANEL */}
        <aside className="context-panel view-related" data-view-related={currentView}>
          <ContextPanel workspace={workspace} issue={issue} />
        </aside>
      </div>
    </>
  );
}

function renderSidebarContent(path: string, navigate: (path: string) => void) {
  async function handleCreateWorkspace() {
    const name = prompt("工作区名称")?.trim();
    if (!name) return;
    const workspaceRoot = prompt("工作区根目录（绝对路径）")?.trim();
    if (!workspaceRoot) return;
    try {
      const result = await api("POST", "/workspaces", { name, summary: "", workspace_root: workspaceRoot, load_from_snail: true });
      showToast("工作区已创建");
      navigate(`/ws/${result.workspace.id}`);
      window.location.reload();
    } catch (err: any) {
      showToast(`创建工作区失败：${err.message}`, true);
    }
  }

  return (
    <div className="view-related workspace-tree" data-view-related="workspaces">
      <div id="workspace-summary-card" hidden />
      <div className="tree-toolbar">
        <div className="panel-title">Workspaces</div>
        <div className="button-row">
          <Button size="sm" onClick={handleCreateWorkspace}>新建</Button>
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
