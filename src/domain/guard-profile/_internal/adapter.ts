import type { Workspace } from "@domain/workspace/model";
import type { GuardProfile } from "@domain/guard-profile/model";
import type { GuardProfilePort } from "@domain/guard-profile/port";
import type { GuardProfileRepository } from "@domain/guard-profile/_internal/repository";

/**
 * Guard Profile 适配器实现。
 * 读取平台级和 workspace 级的安全策略配置，合并后返回。
 */
export class GuardProfileAdapter implements GuardProfilePort {
  constructor(private repo: GuardProfileRepository) {}

  findByWorkspace(workspace: Workspace): GuardProfile {
    return this.repo.findByWorkspace(workspace);
  }
}
