/**
 * MCP Server 域公开 API — 接口层。
 *
 * 调用方只 import 本文件，不关心实现细节。
 * 实现在 _internal/service.ts，启动时绑定。
 */

import type {
  McpToolDefinition,
  McpToolCallResult,
  McpServerInfo,
  JsonRpcRequest,
  JsonRpcResponse,
} from '@/mcp-server/types.js';

/** MCP Server 服务接口 */
export interface McpServerService {
  /** 获取 server 元信息 */
  getServerInfo(): McpServerInfo;

  /** 获取暴露的工具列表 */
  getTools(): McpToolDefinition[];

  /** 处理 MCP 工具调用 */
  handleToolCall(toolName: string, args: Record<string, unknown>): McpToolCallResult;

  /** 处理完整的 JSON-RPC 请求 */
  handleJsonRpc(request: JsonRpcRequest): JsonRpcResponse | null;
}
