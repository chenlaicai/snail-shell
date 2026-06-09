import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api-client";
import { TopBar } from "@/components/TopBar";
import { QueryState } from "@/components/QueryState";
import { queryKeys } from "@/queries/keys";
import { formatRelativeTime } from "@/lib/utils";
import type { KnowledgeSearchResultDto } from "@/types";

export function KnowledgeLibrary() {
  const query = useQuery({
    queryKey: queryKeys.knowledge.items(),
    queryFn: () => api("GET /api/knowledge/items"),
  });

  return (
    <>
      <TopBar breadcrumbs={[{ label: "Knowledge Library" }]} />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">Knowledge Library</h1>
          <p className="text-[13px] text-text-secondary mt-1">Published knowledge from evolution governance</p>
        </div>
        <QueryState query={query} emptyText="No knowledge entries">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {query.data?.map((item) => <KnowledgeCard key={item.id} item={item} />)}
          </div>
        </QueryState>
      </div>
    </>
  );
}

function KnowledgeCard({ item }: { item: KnowledgeSearchResultDto }) {
  return (
    <div className="bg-surface-2 rounded-lg border border-white/6 p-4 hover:bg-surface-3 transition-colors cursor-pointer">
      <div className="flex items-center gap-2 mb-2">
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${item.scope === "global" ? "bg-purple-500/15 text-purple-400" : "bg-blue-500/15 text-blue-400"}`}>{item.scope}</span>
        <span className="text-[11px] text-text-muted">{formatRelativeTime(item.updated_at)}</span>
      </div>
      <h3 className="text-[13px] font-medium mb-1">{item.title}</h3>
      <p className="text-[12px] text-text-secondary line-clamp-3">{item.snippet || item.content}</p>
    </div>
  );
}
