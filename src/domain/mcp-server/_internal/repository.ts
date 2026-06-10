import type { MCPServerCapability } from "@domain/mcp-server/model";

/** MCP Server 持久层接口 */
export interface MCPServerRepository {
  getPlatformServers(): MCPServerCapability[];
  registerPlatformServer(server: MCPServerCapability): void;
}

/** MCP Server 内存存储实现 */
export class InMemoryMCPServerRepository implements MCPServerRepository {
  private platformServers = new Map<string, MCPServerCapability>();

  getPlatformServers(): MCPServerCapability[] {
    return [...this.platformServers.values()];
  }

  registerPlatformServer(server: MCPServerCapability): void {
    if (this.platformServers.has(server.name)) {
      throw new Error(`MCP Server already registered: ${server.name}`);
    }
    this.platformServers.set(server.name, server);
  }
}
