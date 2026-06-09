import { useQuery } from "@tanstack/react-query";
import { TopBar } from "@/components/TopBar";
import { QueryState } from "@/components/QueryState";
import { lobbyQueries } from "@/queries/lobby.queries";
import { formatRelativeTime } from "@/lib/utils";
import type { LobbySessionDto } from "@/types";

export function Lobby() {
  const query = useQuery(lobbyQueries.sessions());

  return (
    <>
      <TopBar breadcrumbs={[{ label: "IM Lobby" }]} />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">IM Lobby</h1>
          <p className="text-[13px] text-text-secondary mt-1">External IM channel sessions</p>
        </div>
        <QueryState query={query} emptyText="No active sessions">
          <div className="space-y-2">
            {query.data?.map((session) => <SessionRow key={session.id} session={session} />)}
          </div>
        </QueryState>
      </div>
    </>
  );
}

function SessionRow({ session }: { session: LobbySessionDto }) {
  return (
    <div className="bg-surface-2 rounded-lg border border-white/6 p-4 hover:bg-surface-3 transition-colors cursor-pointer">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-surface-3 flex items-center justify-center">
            <svg className="w-4 h-4 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div>
            <h3 className="text-[13px] font-medium">{session.channel_type} — {session.channel_chat_id}</h3>
            <span className="text-[11px] text-text-muted">Level: {session.navigation_level}</span>
          </div>
        </div>
        <span className="text-[11px] text-text-muted">{formatRelativeTime(session.last_command_at)}</span>
      </div>
    </div>
  );
}
