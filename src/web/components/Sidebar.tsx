import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { workspaceQueries } from "@/queries/workspace.queries";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const { data: workspaces } = useQuery(workspaceQueries.list());

  return (
    <aside className="w-[240px] shrink-0 bg-surface-1 border-r border-white/6 flex flex-col h-screen">
      <div className="h-14 flex items-center px-4 gap-3 border-b border-white/6">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-shell-500 to-shell-700 flex items-center justify-center">
          <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
            <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
            <circle cx="9" cy="10" r="1" fill="currentColor"/>
            <circle cx="15" cy="10" r="1" fill="currentColor"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">Snail Shell</div>
          <div className="text-xs text-text-secondary">Workspace</div>
        </div>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        <div className="space-y-0.5">
          <SidebarLink to="/evolution" icon={<EvolutionIcon />} label="Evolution" />
          <SidebarLink to="/knowledge" icon={<KnowledgeIcon />} label="Knowledge" />
          <SidebarLink to="/sops" icon={<SopIcon />} label="SOPs" />
          <SidebarLink to="/lobby" icon={<LobbyIcon />} label="IM Lobby" />
        </div>

        <div className="pt-4">
          <div className="px-3 py-1 text-[11px] font-medium text-text-muted uppercase tracking-wider">Projects</div>
          <div className="space-y-0.5 mt-1">
            {workspaces?.map((ws) => (
              <SidebarLink key={ws.id} to={`/workspaces/${ws.id}/board`} icon={<LayersIcon />} label={ws.path} />
            ))}
          </div>
        </div>

        <div className="pt-4">
          <div className="px-3 py-1 text-[11px] font-medium text-text-muted uppercase tracking-wider">Config</div>
          <div className="space-y-0.5 mt-1">
            <SidebarLink to="/prompts" icon={<PromptIcon />} label="Prompts" />
            <SidebarLink to="/skills" icon={<SkillIcon />} label="Skills" />
            <SidebarLink to="/snail-den" icon={<SnailDenIcon />} label="Snail Den" />
            <SidebarLink to="/mcps" icon={<McpIcon />} label="MCPs" />
          </div>
        </div>
      </nav>
    </aside>
  );
}

function SidebarLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] transition-colors",
          isActive ? "bg-white/7 text-text-primary font-medium" : "text-text-secondary hover:bg-white/5",
        )
      }
    >
      {icon}
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

function LayersIcon() {
  return (
    <div className="w-4 h-4 rounded bg-shell-500/20 flex items-center justify-center">
      <svg className="w-2.5 h-2.5 text-shell-400" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>
    </div>
  );
}

function EvolutionIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  );
}

function KnowledgeIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  );
}

function SopIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
    </svg>
  );
}

function LobbyIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  );
}

function PromptIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
  );
}

function SkillIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  );
}

function SnailDenIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
    </svg>
  );
}

function McpIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  );
}
