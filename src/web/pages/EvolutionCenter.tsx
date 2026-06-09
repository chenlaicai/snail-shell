import { useQuery } from "@tanstack/react-query";
import { TopBar } from "@/components/TopBar";
import { QueryState } from "@/components/QueryState";
import { evolutionQueries } from "@/queries/evolution.queries";
import { formatRelativeTime } from "@/lib/utils";
import type { EvolutionItemSearchResultDto } from "@/types";

export function EvolutionCenter() {
  const query = useQuery(evolutionQueries.items());

  return (
    <>
      <TopBar breadcrumbs={[{ label: "Evolution Center" }]} />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">Evolution Center</h1>
          <p className="text-[13px] text-text-secondary mt-1">System self-extracted governance items</p>
        </div>
        <QueryState query={query} emptyText="No evolution items">
          <div className="space-y-2">
            {query.data?.map((item) => <EvolutionItemRow key={item.id} item={item} />)}
          </div>
        </QueryState>
      </div>
    </>
  );
}

function EvolutionItemRow({ item }: { item: EvolutionItemSearchResultDto }) {
  return (
    <div className="bg-surface-2 rounded-lg border border-white/6 p-4 hover:bg-surface-3 transition-colors cursor-pointer">
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-[13px] font-medium">{item.title}</h3>
        <span className="text-[11px] text-text-muted">{formatRelativeTime(item.updated_at)}</span>
      </div>
      <p className="text-[12px] text-text-secondary line-clamp-2">{item.content}</p>
      {item.tags.length > 0 && (
        <div className="flex items-center gap-1.5 mt-2">
          {item.tags.map((tag) => (
            <span key={tag} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-shell-600/20 text-shell-400">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}
