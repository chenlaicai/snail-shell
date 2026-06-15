import type { Workspace } from "@domain/workspace/model";
import type { KnowledgeEntry, CreateKnowledgeInput, RemoveKnowledgeInput } from "@domain/knowledge/model";
import type { KnowledgePort } from "@domain/knowledge/port";
import type { KnowledgeRepository } from "@domain/knowledge/_internal/repository";

/**
 * Knowledge 适配器实现。
 * 实现业务逻辑，调用 repository 完成持久化。
 */
export class KnowledgeAdapter implements KnowledgePort {
  constructor(private repo: KnowledgeRepository) {}

  list(): KnowledgeEntry[] {
    return this.repo.list();
  }

  findByWorkspace(workspace: Workspace): KnowledgeEntry[] {
    return this.repo.findByWorkspace(workspace);
  }

  add(input: CreateKnowledgeInput): KnowledgeEntry {
    return this.repo.add(input);
  }

  remove(input: RemoveKnowledgeInput): void {
    this.repo.remove(input);
  }
}
