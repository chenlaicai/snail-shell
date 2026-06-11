import type { Workspace } from "@domain/workspace/model";
import { Scope } from "@domain/workspace/model";
import type { MCPConfig } from "@domain/mcp/model";
import type { FileDataStore } from "@infra/file-data-store";

/** MCP 持久层接口 */
export interface MCPRepository {
  list(): MCPConfig[];
  findByWorkspace(workspace: Workspace): MCPConfig[];
}

/** MCP 文件存储实现 */
export class FileMCPRepository implements MCPRepository {
  private static readonly FILE = "mcp.json";

  private platformConfigs: MCPConfig[] = [];
  private workspaceConfigs = new Map<string, MCPConfig[]>();

  constructor(private dataStore: FileDataStore, workspaces: Workspace[]) {
    this.platformConfigs = this.loadConfigFile(this.dataStore);
    for (const ws of workspaces) {
      const wsStore = this.dataStore.workspace(ws.path);
      const configs = this.loadConfigFile(wsStore)
        .map(c => ({ ...c, scope: Scope.Workspace, workspace: ws }));
      this.workspaceConfigs.set(ws.path, configs);
    }
  }

  list(): MCPConfig[] {
    return [...this.platformConfigs, ...this.workspaceConfigs.values()].flat();
  }

  findByWorkspace(workspace: Workspace): MCPConfig[] {
    const wsConfigs = this.workspaceConfigs.get(workspace.path) ?? [];
    return [...this.platformConfigs, ...wsConfigs];
  }

  private loadConfigFile(store: FileDataStore): MCPConfig[] {
    const raw = store.readJson<{ mcpServers?: Record<string, Record<string, unknown>> }>(FileMCPRepository.FILE);
    if (!raw?.mcpServers) return [];

    const configs: MCPConfig[] = [];
    for (const [name, config] of Object.entries(raw.mcpServers)) {
      configs.push({
        name,
        command: config.command as string | undefined,
        args: config.args as string[] | undefined,
        env: config.env as Record<string, string> | undefined,
        url: config.url as string | undefined,
        scope: Scope.Platform,
      });
    }

    return configs;
  }
}
