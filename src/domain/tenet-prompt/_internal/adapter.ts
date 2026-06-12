import type { Workspace } from "@domain/workspace/model";
import type { PromptDocument } from "@domain/tenet-prompt/model";
import type { TenetPromptPort } from "@domain/tenet-prompt/port";
import type { TenetPromptRepository } from "./repository";

/**
 * TenetPrompt 适配器实现。
 * 实现业务逻辑，调用 repository 完成持久化。
 */
export class TenetPromptAdapter implements TenetPromptPort {
  constructor(private repo: TenetPromptRepository) {}

  list(): PromptDocument[] {
    return this.repo.list();
  }

  findByWorkspace(workspace: Workspace, tags?: string[]): PromptDocument[] {
    return this.repo.findByWorkspace(workspace, tags);
  }
}
