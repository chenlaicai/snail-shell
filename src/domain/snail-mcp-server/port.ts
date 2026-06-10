import type { MCPServerConfig, JsonRpcRequest, JsonRpcResponse } from "./model";

/** Snail MCP Server 端口定义 */
export interface SnailMCPServerPort {
  /** 注册 MCP Server */
  registerServer(config: MCPServerConfig): void;

  /** 获取所有已注册的 Server */
  listServers(): MCPServerConfig[];

  /** 按名称查找 Server */
  findServer(name: string): MCPServerConfig | undefined;

  /** 处理 JSON-RPC 请求 */
  handleRequest(serverName: string, request: JsonRpcRequest): Promise<JsonRpcResponse>;
}
