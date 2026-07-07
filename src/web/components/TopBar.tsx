import { useNavigate } from "react-router-dom";
import { navTrace } from "@/lib/nav-trace";

interface TopBarProps {
  breadcrumbs: Array<{ label: string; to?: string }>;
}

export function TopBar({ breadcrumbs }: TopBarProps) {
  const navigate = useNavigate();

  function handleNavigate(to: string) {
    navTrace("navigate", { from: location.pathname, to });
    navigate(to);
  }

  return (
    <header className="h-14 flex items-center px-6 gap-4 border-b border-white/6 shrink-0">
      <div className="flex items-center gap-2 text-[13px]">
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-2">
            {i > 0 && (
              <svg className="w-3.5 h-3.5 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
            )}
            {crumb.to ? (
              <button onClick={() => handleNavigate(crumb.to!)} className="text-text-secondary hover:text-text-primary transition-colors">
                {crumb.label}
              </button>
            ) : (
              <span className="text-text-primary font-medium">{crumb.label}</span>
            )}
          </span>
        ))}
      </div>
    </header>
  );
}
