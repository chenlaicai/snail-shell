import type { MCPServerCapability, MCPTool, MCPServerInfo } from "@domain/mcp-server/model";
import type { MCPServerPort } from "@domain/mcp-server/port";
import type { MCPServerRepository } from "./repository";

/**
 * MCP Server 适配器实现。
 * 实现业务逻辑，调用 repository 完成持久化。
 */
export class MCPServerAdapter implements MCPServerPort {
  constructor(private repo: MCPServerRepository) {}

  getServerInfo(): MCPServerInfo {
    return {
      name: "snail-final-response",
      version: "1.0.0",
    };
  }

  listTools(): MCPTool[] {
    return [
      {
        name: "set_final_body",
        description: "设置消息的最终展示正文（Markdown）",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "最终 Markdown 正文" },
            conversation_id: { type: "string" },
            message_id: { type: "string" },
          },
          required: ["text", "conversation_id", "message_id"],
        },
      },
    ];
  }

  registerPlatformServer(server: MCPServerCapability): void {
    this.repo.registerPlatformServer(server);
  }

  getActiveServers(workspaceRoot?: string): MCPServerCapability[] {
    return this.repo.getPlatformServers();
  }
}
