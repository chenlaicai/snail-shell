import { useQuery } from "@tanstack/react-query";
import { mcpCapabilityQueries } from "@/queries/mcp-capability.queries";
import { Badge } from "@/components/ui/badge";
import type { McpServerConfig } from "@/mcp-capability/types.js";

export function McpCapabilityPanel() {
  const servers = useQuery(mcpCapabilityQueries.servers());
  const platform = useQuery(mcpCapabilityQueries.platformServers());
  const workspace = useQuery(mcpCapabilityQueries.workspaceServers());

  if (servers.isLoading) {
    return <div className="p-4 text-muted-foreground">Loading...</div>;
  }

  if (servers.error) {
    return (
      <div className="p-4 text-destructive">
        {servers.error instanceof Error ? servers.error.message : "Failed to load MCP servers"}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      {/* Summary */}
      <section>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Summary</h3>
        <div className="flex gap-2">
          <Badge variant="default">Total: {servers.data?.length ?? 0}</Badge>
          <Badge variant="secondary">Platform: {platform.data?.length ?? 0}</Badge>
          <Badge variant="outline">Workspace: {workspace.data?.length ?? 0}</Badge>
        </div>
      </section>

      {/* Platform Servers */}
      {platform.data && platform.data.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">Platform Servers</h3>
          <div className="space-y-2">
            {platform.data.map((s) => (
              <ServerCard key={s.name} server={s} />
            ))}
          </div>
        </section>
      )}

      {/* Workspace Servers */}
      {workspace.data && workspace.data.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">Workspace Servers</h3>
          <div className="space-y-2">
            {workspace.data.map((s) => (
              <ServerCard key={s.name} server={s} />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {servers.data?.length === 0 && (
        <div className="text-center text-muted-foreground py-8">
          No MCP servers configured
        </div>
      )}
    </div>
  );
}

function ServerCard({ server }: { server: McpServerConfig }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 mb-2">
        <code className="text-sm font-mono font-medium">{server.name}</code>
        <Badge variant="outline">{server.transport}</Badge>
        <Badge variant={server.source === "platform" ? "default" : "secondary"}>
          {server.source}
        </Badge>
      </div>
      <div className="text-sm text-muted-foreground font-mono">
        {server.transport === "stdio" ? (
          <span>
            {server.command}
            {server.args && server.args.length > 0 && ` ${server.args.join(" ")}`}
          </span>
        ) : (
          <span>{server.url}</span>
        )}
      </div>
    </div>
  );
}
