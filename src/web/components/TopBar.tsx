import { useNavigate } from "react-router-dom";

interface TopBarProps {
  breadcrumbs: Array<{ label: string; to?: string }>;
}

export function TopBar({ breadcrumbs }: TopBarProps) {
  const navigate = useNavigate();

  return (
    <header className="h-14 flex items-center px-6 gap-4 border-b border-white/6 shrink-0">
      <div className="flex items-center gap-2 text-[13px]">
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-2">
            {i > 0 && (
              <svg className="w-3.5 h-3.5 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
            )}
            {crumb.to ? (
              <button onClick={() => navigate(crumb.to!)} className="text-text-secondary hover:text-text-primary transition-colors">
                {crumb.label}
              </button>
            ) : (
              <span className="font-medium">{crumb.label}</span>
            )}
          </span>
        ))}
      </div>

      <div className="flex-1" />

      {/* Search */}
      <div className="flex items-center gap-2 bg-surface-2 border border-white/6 rounded-md px-3 h-8 w-64">
        <svg className="w-3.5 h-3.5 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span className="text-xs text-text-muted">Search issues...</span>
        <span className="ml-auto text-[11px] text-text-grey border border-white/6 rounded px-1 py-px">/</span>
      </div>

      {/* Notification */}
      <button className="w-8 h-8 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      </button>
    </header>
  );
}
