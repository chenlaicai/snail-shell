import type { PromptDocument } from "@domain/tenet-prompt/model";
import type { TenetPrompt } from "@domain/tenet-prompt/port";
import type { TenetPromptRepository } from "./repository";

/**
 * TenetPrompt 适配器实现。
 * 实现业务逻辑，调用 repository 完成持久化。
 */
export class TenetPromptAdapter implements TenetPrompt {
  constructor(private repo: TenetPromptRepository) {}

  list(): PromptDocument[] {
    return this.repo.list();
  }

  findById(id: string): PromptDocument | undefined {
    return this.repo.findById(id);
  }

  filter(match: {
    runtime?: string;
    stage_type?: string;
    role?: string;
    conversation_kind?: string;
  }): PromptDocument[] {
    return this.list().filter(doc => {
      if (!doc.when) return true;

      if (match.runtime && doc.when.runtimes?.length) {
        if (!doc.when.runtimes.includes(match.runtime)) return false;
      }
      if (match.stage_type && doc.when.stage_types?.length) {
        if (!doc.when.stage_types.includes(match.stage_type)) return false;
      }
      if (match.role && doc.when.roles?.length) {
        if (!doc.when.roles.includes(match.role)) return false;
      }
      if (match.conversation_kind && doc.when.conversation_kinds?.length) {
        if (!doc.when.conversation_kinds.includes(match.conversation_kind)) return false;
      }

      return true;
    });
  }
}
