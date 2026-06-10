import type { Workspace, CreateWorkspaceInput } from "@domain/workspace/model";
import type { WorkspacePort } from "@domain/workspace/port";
import type { WorkspaceRepository } from "./repository";

/**
 * Workspace 适配器实现。
 * 实现业务逻辑，调用 repository 完成持久化。
 */
export class WorkspaceAdapter implements WorkspacePort {
  constructor(private repo: WorkspaceRepository) {}

  list(limit?: number, offset?: number): Workspace[] {
    return this.repo.list(limit, offset);
  }

  add(input: CreateWorkspaceInput): Workspace {
    return this.repo.add(input);
  }
}
