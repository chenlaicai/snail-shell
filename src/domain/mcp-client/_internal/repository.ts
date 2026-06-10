import type { MCPServerCapability } from "@domain/mcp-server/model";
import type { AgentType, MCPConfigResult } from "@domain/mcp-client/model";

/** MCP Client 持久层接口 */
export interface MCPClientRepository {
  writeClaudeConfig(mcpServers: MCPServerCapability[], wsRoot: string): MCPConfigResult;
  writeOpenCodeConfig(mcpServers: MCPServerCapability[], wsRoot: string): MCPConfigResult;
  writeCodexConfig(mcpServers: MCPServerCapability[], wsRoot: string): MCPConfigResult;
}
