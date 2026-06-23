import type { Workspace } from "@domain/workspace/model";
import type { MCPConfig } from "@domain/mcp-config/model";
import type { MCPPort } from "@domain/mcp-config/port";
import type { MCPRepository } from "@domain/mcp-config/_internal/repository";

/**
 * MCP 适配器实现。
 * 实现业务逻辑，调用 repository 完成持久化。
 */
export class MCPAdapter implements MCPPort {
  constructor(private repo: MCPRepository) {}

  list(): MCPConfig[] {
    return this.repo.list();
  }

  findByWorkspace(workspace: Workspace): MCPConfig[] {
    return this.repo.findByWorkspace(workspace);
  }
}
