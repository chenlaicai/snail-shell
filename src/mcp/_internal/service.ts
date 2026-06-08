/**
 * MCP service implementation.
 *
 * Platform servers: registered programmatically at startup.
 * Workspace servers: loaded from .snail/mcp.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { McpService } from '@/mcp/api.js';
import type { McpServerConfig } from '@/mcp/types.js';

export class McpServiceImpl implements McpService {
  private platformServers: McpServerConfig[] = [];
  private workspaceCache: McpServerConfig[] | null = null;

  constructor(private workspaceRoot?: string) {}

  listPlatform(): McpServerConfig[] {
    return [...this.platformServers];
  }

  listWorkspace(): McpServerConfig[] {
    if (!this.workspaceCache) {
      this.workspaceCache = this.loadWorkspaceConfig();
    }
    return this.workspaceCache;
  }

  listAll(): McpServerConfig[] {
    const platform = this.listPlatform();
    const workspace = this.listWorkspace();
    this.validateNoCollision(platform, workspace);
    return [...platform, ...workspace];
  }

  registerPlatformServer(config: McpServerConfig): void {
    this.platformServers.push({ ...config, source: 'platform' });
  }

  // ─── internal ───

  private loadWorkspaceConfig(): McpServerConfig[] {
    if (!this.workspaceRoot) return [];
    const filePath = path.join(this.workspaceRoot, '.snail', 'mcp.json');
    if (!fs.existsSync(filePath)) return [];

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      const servers: McpServerConfig[] = [];

      for (const [name, config] of Object.entries(data.mcpServers ?? {})) {
        const cfg = config as Record<string, unknown>;
        servers.push({
          name,
          command: cfg.command as string | undefined,
          args: cfg.args as string[] | undefined,
          env: cfg.env as Record<string, string> | undefined,
          url: cfg.url as string | undefined,
          source: 'workspace',
        });
      }

      return servers;
    } catch {
      return [];
    }
  }

  private validateNoCollision(platform: McpServerConfig[], workspace: McpServerConfig[]): void {
    const platformNames = new Set(platform.map(s => s.name));
    for (const server of workspace) {
      if (platformNames.has(server.name)) {
        throw new Error(`MCP server name collision: "${server.name}" exists in both platform and workspace`);
      }
    }
  }
}
