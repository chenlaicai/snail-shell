import type { Workspace, Scope } from "@domain/workspace/model";
import { Scope as ScopeEnum } from "@domain/workspace/model";
import type { MCPConfig } from "@domain/mcp-config/model";
import type { SnailMCPServerPort } from "@domain/snail-mcp-server/port";
import type { FileDataStore } from "@infra/file-data-store";

/** MCP 持久层接口 */
export interface MCPRepository {
  list(): MCPConfig[];
  findByWorkspace(workspace: Workspace): MCPConfig[];
}

/**
 * MCP 文件存储实现。
 *
 * 读取平台级 config/mcp.json 和 workspace 级 <workspace>/.snail/mcp.json。
 * 同时读取 snail-mcp-server 中注册的 MCP Server。
 */
export class FileMCPRepository implements MCPRepository {
  private static readonly FILE = "mcp.json";

  private platformConfigs: MCPConfig[] = [];
  private workspaceConfigs = new Map<string, MCPConfig[]>();

  constructor(
    private dataStore: FileDataStore,
    private workspaces: Workspace[],
    private snailMCPServer: SnailMCPServerPort,
    private baseUrl: string,
  ) {
    this.loadPlatformConfigs();
    this.loadWorkspaceConfigs();
    this.loadSnailMCPServerConfigs();
  }

  list(): MCPConfig[] {
    return [...this.platformConfigs, ...this.workspaceConfigs.values()].flat();
  }

  findByWorkspace(workspace: Workspace): MCPConfig[] {
    const workspaceConfigs = this.workspaceConfigs.get(workspace.path) ?? [];
    return [...this.platformConfigs, ...workspaceConfigs];
  }

  private loadPlatformConfigs(): void {
    this.platformConfigs = this.loadConfigFile(this.dataStore, ScopeEnum.Platform);
  }

  private loadWorkspaceConfigs(): void {
    for (const workspace of this.workspaces) {
      const workspaceStore = this.dataStore.workspace(workspace.path);
      const configs = this.loadConfigFile(workspaceStore, ScopeEnum.Workspace);
      this.workspaceConfigs.set(workspace.path, configs);
    }
  }

  /** 从 snail-mcp-server 读取注册的 MCP Server */
  private loadSnailMCPServerConfigs(): void {
    const servers = this.snailMCPServer.listServers();
    for (const server of servers) {
      this.platformConfigs.push({
        name: server.name,
        url: `${this.baseUrl}/mcp-server/${server.name}`,
        scope: ScopeEnum.Platform,
        source: 'builtin',
      });
    }
  }

  private loadConfigFile(store: FileDataStore, scope: Scope): MCPConfig[] {
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
        scope,
        source: scope === ScopeEnum.Workspace ? 'workspace' : 'platform',
      });
    }

    return configs;
  }
}
