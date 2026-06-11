import type { Workspace, Scope } from "@domain/workspace/model";
import { Scope as ScopeEnum } from "@domain/workspace/model";
import type { MCPConfig } from "@domain/mcp/model";
import type { MCPServerPort } from "@domain/snail-mcp-server/port";
import type { FileDataStore } from "@infra/file-data-store";

/** MCP 持久层接口 */
export interface MCPRepository {
  list(): MCPConfig[];
  findByWorkspace(workspace: Workspace): MCPConfig[];
}

/**
 * MCP 文件存储实现。
 *
 * 读取平台级 config/mcp.json 和 workspace 级 <ws>/.snail/mcp.json。
 * 同时读取 snail-mcp-server 中注册的 MCP Server。
 */
export class FileMCPRepository implements MCPRepository {
  private static readonly FILE = "mcp.json";

  private platformConfigs: MCPConfig[] = [];
  private workspaceConfigs = new Map<string, MCPConfig[]>();

  constructor(
    private dataStore: FileDataStore,
    private workspaces: Workspace[],
    private snailMCPServer: MCPServerPort,
  ) {
    this.loadPlatformConfigs();
    this.loadWorkspaceConfigs();
    this.loadSnailMCPServerConfigs();
  }

  list(): MCPConfig[] {
    return [...this.platformConfigs, ...this.workspaceConfigs.values()].flat();
  }

  findByWorkspace(workspace: Workspace): MCPConfig[] {
    const wsConfigs = this.workspaceConfigs.get(workspace.path) ?? [];
    return [...this.platformConfigs, ...wsConfigs];
  }

  private loadPlatformConfigs(): void {
    this.platformConfigs = this.loadConfigFile(this.dataStore, ScopeEnum.Platform);
  }

  private loadWorkspaceConfigs(): void {
    for (const ws of this.workspaces) {
      const wsStore = this.dataStore.workspace(ws.path);
      const configs = this.loadConfigFile(wsStore, ScopeEnum.Workspace);
      this.workspaceConfigs.set(ws.path, configs);
    }
  }

  /** 从 snail-mcp-server 读取注册的 MCP Server */
  private loadSnailMCPServerConfigs(): void {
    const servers = this.snailMCPServer.listServers();
    for (const server of servers) {
      this.platformConfigs.push({
        name: server.name,
        url: `http://localhost:3000/mcp/${server.name}`,
        scope: ScopeEnum.Platform,
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
      });
    }

    return configs;
  }
}
