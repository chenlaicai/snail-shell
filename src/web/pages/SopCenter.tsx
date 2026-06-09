import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api-client";
import { TopBar } from "@/components/TopBar";
import { QueryState } from "@/components/QueryState";
import { queryKeys } from "@/queries/keys";
import { formatRelativeTime } from "@/lib/utils";
import type { SopDto } from "@/types";

export function SopCenter() {
  const query = useQuery({
    queryKey: queryKeys.sops.all,
    queryFn: () => api("GET /api/sops"),
  });

  return (
    <>
      <TopBar breadcrumbs={[{ label: "SOP Center" }]} />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold">SOP Center</h1>
            <p className="text-[13px] text-text-secondary mt-1">Standard Operating Procedures</p>
          </div>
        </div>
        <QueryState query={query} emptyText="No SOPs">
          <div className="space-y-2">
            {query.data?.map((sop) => <SopRow key={sop.id} sop={sop} />)}
          </div>
        </QueryState>
      </div>
    </>
  );
}

function SopRow({ sop }: { sop: SopDto }) {
  return (
    <div className="bg-surface-2 rounded-lg border border-white/6 p-4 hover:bg-surface-3 transition-colors cursor-pointer">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${sop.source === "platform" ? "bg-purple-500/15 text-purple-400" : "bg-blue-500/15 text-blue-400"}`}>
            {sop.source}
          </span>
          <div>
            <h3 className="text-[13px] font-medium">{sop.name}</h3>
            <span className="text-[11px] text-text-muted font-mono">{sop.key}</span>
          </div>
        </div>
        <span className="text-[11px] text-text-muted">{formatRelativeTime(sop.updated_at)}</span>
      </div>
      {sop.description && <p className="text-[12px] text-text-secondary mt-2">{sop.description}</p>}
    </div>
  );
}
