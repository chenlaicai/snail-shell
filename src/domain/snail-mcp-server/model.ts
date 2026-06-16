/** MCP 工具定义 */
export interface MCPTool {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 输入参数 schema */
  inputSchema: Record<string, unknown>;
  /** 工具处理函数 */
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

/** MCP Server 配置 */
export interface MCPServerConfig {
  /** Server 名称（用于 URL 路径） */
  name: string;
  /** Server 版本 */
  version: string;
  /** 工具列表 */
  tools: MCPTool[];
}

/** JSON-RPC 2.0 请求 */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 响应 */
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}
