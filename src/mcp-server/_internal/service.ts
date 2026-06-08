/**
 * MCP Server 服务实现。
 *
 * 外部禁止 import，通过 mcp-server/api.ts 接口访问。
 * 启动时在 main.ts 中实例化并注入 tool handlers。
 */

import type { McpServerService } from '@/mcp-server/api.js';
import type {
  McpToolDefinition,
  McpToolCallResult,
  McpServerInfo,
  JsonRpcRequest,
  JsonRpcResponse,
} from '@/mcp-server/types.js';
import type { ToolHandler, ToolRegistration } from './tools.js';
import { DEFAULT_TOOLS } from './tools.js';

export class McpServerServiceImpl implements McpServerService {
  private tools: ToolRegistration[] = [];

  constructor(
    private serverInfo: McpServerInfo,
    toolHandlers: Map<string, ToolHandler>,
  ) {
    for (const def of DEFAULT_TOOLS) {
      const handler = toolHandlers.get(def.name);
      if (handler) {
        this.tools.push({ definition: def, handler });
      }
    }
  }

  getServerInfo(): McpServerInfo {
    return this.serverInfo;
  }

  getTools(): McpToolDefinition[] {
    return this.tools.map(t => t.definition);
  }

  handleToolCall(toolName: string, args: Record<string, unknown>): McpToolCallResult {
    const tool = this.tools.find(t => t.definition.name === toolName);
    if (!tool) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${toolName}` }) }] };
    }
    return tool.handler(args);
  }

  handleJsonRpc(request: JsonRpcRequest): JsonRpcResponse | null {
    const { method, params, id } = request;

    // 缺少 method → 解析错误
    if (!method) {
      return { jsonrpc: '2.0', id: id ?? null, error: { code: -32600, message: 'Invalid Request' } };
    }

    // JSON-RPC 2.0 notification：有 method 但无 id，不需要响应
    if (id === undefined) {
      return null;
    }

    let result: unknown;
    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: this.serverInfo,
        };
        break;
      case 'tools/list':
        result = { tools: this.getTools() };
        break;
      case 'tools/call': {
        const p = params ?? {};
        const callToolName = typeof p.name === 'string' ? p.name : '';
        const callArgs = (p.arguments ?? {}) as Record<string, unknown>;
        result = this.handleToolCall(callToolName, callArgs);
        break;
      }
      default:
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }

    return { jsonrpc: '2.0', id: id ?? null, result };
  }
}
