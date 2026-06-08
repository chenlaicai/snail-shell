/**
 * MCP Server 域公开类型。
 *
 * Snail Shell 自身作为 MCP server 暴露给 agent 的能力定义。
 */

/** MCP 工具定义 */
export interface McpToolDefinition {
  /** 工具名称 */
  name: string;
  /** 工具功能描述 */
  description: string;
  /** JSON Schema 输入参数 */
  inputSchema: Record<string, unknown>;
}

/** MCP 工具调用结果 */
export interface McpToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
}

/** MCP server 元信息 */
export interface McpServerInfo {
  name: string;
  version: string;
}

/** JSON-RPC 2.0 请求 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 响应 */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}
