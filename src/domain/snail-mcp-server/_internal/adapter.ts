import type {
  MCPServerConfig,
  JsonRpcRequest,
  JsonRpcResponse,
} from "@domain/snail-mcp-server/model";
import type { SnailMCPServerPort } from "@domain/snail-mcp-server/port";

/**
 * Snail MCP Server 适配器实现。
 * 管理多个 MCP Server，处理 JSON-RPC 2.0 请求。
 */
export class SnailMCPServerAdapter implements SnailMCPServerPort {
  private servers = new Map<string, MCPServerConfig>();

  registerServer(config: MCPServerConfig): void {
    if (this.servers.has(config.name)) {
      throw new Error(`MCP Server already registered: ${config.name}`);
    }
    this.servers.set(config.name, config);
  }

  listServers(): MCPServerConfig[] {
    return [...this.servers.values()];
  }

  findServer(name: string): MCPServerConfig | undefined {
    return this.servers.get(name);
  }

  async handleRequest(serverName: string, request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const server = this.servers.get(serverName);
    if (!server) {
      return this.createError(request.id, -32601, `Server not found: ${serverName}`);
    }

    try {
      switch (request.method) {
        case "initialize":
          return this.handleInitialize(request, server);
        case "tools/list":
          return this.handleToolsList(request, server);
        case "tools/call":
          return this.handleToolsCall(request, server);
        default:
          return this.createError(request.id, -32601, `Method not found: ${request.method}`);
      }
    } catch (err) {
      return this.createError(request.id, -32603, (err as Error).message);
    }
  }

  private handleInitialize(request: JsonRpcRequest, server: MCPServerConfig): JsonRpcResponse {
    return this.createResult(request.id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: server.name, version: server.version },
    });
  }

  private handleToolsList(request: JsonRpcRequest, server: MCPServerConfig): JsonRpcResponse {
    const tools = server.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
    return this.createResult(request.id, { tools });
  }

  private async handleToolsCall(request: JsonRpcRequest, server: MCPServerConfig): Promise<JsonRpcResponse> {
    const params = request.params as { name: string; arguments?: Record<string, unknown> } | undefined;
    if (!params?.name) {
      return this.createError(request.id, -32602, "Missing tool name");
    }

    const tool = server.tools.find(t => t.name === params.name);
    if (!tool) {
      return this.createError(request.id, -32602, `Tool not found: ${params.name}`);
    }

    try {
      const result = await tool.handler(params.arguments ?? {});
      return this.createResult(request.id, {
        content: [{ type: "text", text: JSON.stringify(result) }],
      });
    } catch (err) {
      return this.createResult(request.id, {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      });
    }
  }

  private createResult(id: number | string | undefined, result: unknown): JsonRpcResponse {
    return { jsonrpc: "2.0", id, result };
  }

  private createError(id: number | string | undefined, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }
}
