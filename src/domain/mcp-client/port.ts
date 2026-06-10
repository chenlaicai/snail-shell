import type { MCPServerCapability } from "@domain/mcp-server/model";
import type { AgentType, MCPConfigResult } from "./model";

/** MCP Client 端口定义 */
export interface MCPClientPort {
  /**
   * 将 MCP Server 配置翻译为 Agent 原生配置格式并写入文件。
   * Agent CLI 自身作为实际的 MCP Client 连接 MCP Server。
   */
  ensureMcpServers(
    mcpServers: MCPServerCapability[],
    workspaceRoot: string,
    agentType: AgentType,
  ): MCPConfigResult;
}
