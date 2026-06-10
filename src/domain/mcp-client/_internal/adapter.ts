import type { MCPServerCapability } from "@domain/mcp-server/model";
import type { AgentType, MCPConfigResult } from "@domain/mcp-client/model";
import type { MCPClientPort } from "@domain/mcp-client/port";
import type { MCPClientRepository } from "./repository";

/**
 * MCP Client 适配器实现。
 * 实现业务逻辑，调用 repository 完成持久化。
 */
export class MCPClientAdapter implements MCPClientPort {
  constructor(private repo: MCPClientRepository) {}

  ensureMcpServers(
    mcpServers: MCPServerCapability[],
    workspaceRoot: string,
    agentType: AgentType,
  ): MCPConfigResult {
    switch (agentType) {
      case "claude":
        return this.repo.writeClaudeConfig(mcpServers, workspaceRoot);
      case "opencode":
        return this.repo.writeOpenCodeConfig(mcpServers, workspaceRoot);
      case "codex":
        return this.repo.writeCodexConfig(mcpServers, workspaceRoot);
      default:
        throw new Error(`Unsupported agent type: ${agentType}`);
    }
  }
}
