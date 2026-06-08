/**
 * 工具注册表。
 *
 * 定义 Snail Shell 暴露给 agent 的 MCP 工具。
 * 工具的业务逻辑通过 handler 回调注入，模块自身不依赖存储。
 */

import type { McpToolDefinition, McpToolCallResult } from '@/mcp-server/types.js';

/** 工具 handler 类型：接收参数，返回结果 */
export type ToolHandler = (args: Record<string, unknown>) => McpToolCallResult;

/** 工具注册项 */
export interface ToolRegistration {
  definition: McpToolDefinition;
  handler: ToolHandler;
}

/** 默认工具定义（不含 handler，handler 由启动时注入） */
export const DEFAULT_TOOLS: McpToolDefinition[] = [
  {
    name: 'set_final_body',
    description:
      '设置当前消息的最终展示正文。当你完成分析、准备向用户展示最终结果时调用此工具。' +
      '调用后，你的最终正文将替代流式过程作为消息的主要展示内容，' +
      '流式过程中的中间分析将被折叠。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '最终展示给用户的正文内容（支持 Markdown）' },
        conversation_id: { type: 'string', description: '当前对话 ID，从系统提示词中的 <mcp_context> 获取' },
        message_id: { type: 'string', description: '当前消息 ID，从系统提示词中的 <mcp_context> 获取' },
      },
      required: ['text', 'conversation_id', 'message_id'],
    },
  },
];
