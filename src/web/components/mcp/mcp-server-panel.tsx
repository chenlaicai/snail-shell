import { useQuery } from "@tanstack/react-query";
import { mcpServerQueries } from "@/queries/mcp-server.queries";
import { Badge } from "@/components/ui/badge";

export function McpServerPanel() {
  const info = useQuery(mcpServerQueries.info());
  const tools = useQuery(mcpServerQueries.tools());

  if (info.isLoading || tools.isLoading) {
    return <div className="p-4 text-muted-foreground">Loading...</div>;
  }

  if (info.error || tools.error) {
    return <div className="p-4 text-destructive">Failed to load MCP server info</div>;
  }

  return (
    <div className="space-y-6 p-4">
      {/* Server Info */}
      <section>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Server Info</h3>
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold">{info.data?.name}</span>
          <Badge variant="secondary">v{info.data?.version}</Badge>
        </div>
      </section>

      {/* Tools */}
      <section>
        <h3 className="text-sm font-medium text-muted-foreground mb-3">
          Exposed Tools
          <Badge variant="outline" className="ml-2">{tools.data?.length ?? 0}</Badge>
        </h3>
        <div className="space-y-3">
          {tools.data?.map((tool) => (
            <div
              key={tool.name}
              className="rounded-lg border p-4"
            >
              <div className="flex items-center gap-2 mb-1">
                <code className="text-sm font-mono font-medium">{tool.name}</code>
              </div>
              <p className="text-sm text-muted-foreground">{tool.description}</p>
              {tool.inputSchema.properties && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Parameters</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(tool.inputSchema.properties as Record<string, { type: string; description?: string }>).map(
                      ([key, prop]) => (
                        <span
                          key={key}
                          className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs font-mono"
                        >
                          {key}
                          <span className="text-muted-foreground">{prop.type}</span>
                          {(tool.inputSchema.required as string[] | undefined)?.includes(key) && (
                            <span className="text-destructive">*</span>
                          )}
                        </span>
                      ),
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
