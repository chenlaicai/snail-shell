import type { Workspace } from "@domain/workspace/model";
import type { Sop } from "@domain/sop/model";
import type { SopPort } from "@domain/sop/port";
import type { SopRepository } from "@domain/sop/_internal/repository";

/**
 * SOP 适配器实现。
 * 实现业务逻辑，调用 repository 完成持久化。
 */
export class SopAdapter implements SopPort {
  constructor(private repo: SopRepository) {}

  list(): Sop[] {
    return this.repo.list();
  }

  findByKey(key: string): Sop | undefined {
    return this.repo.findByKey(key);
  }

  findByWorkspace(workspace: Workspace): Sop[] {
    return this.repo.findByWorkspace(workspace);
  }
}
