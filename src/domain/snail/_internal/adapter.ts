import type {
  SnailTemplate,
  SnailRuntimeInstance,
  SnailAgentSession,
  CreateSnailAgentSessionInput,
} from "@domain/snail/model";
import type { SnailPort } from "@domain/snail/port";
import type { SnailRepository } from "./repository";

/**
 * Snail 适配器实现。
 * 实现业务逻辑，调用 repository 完成持久化。
 */
export class SnailAdapter implements SnailPort {
  constructor(private repo: SnailRepository) {}

  listTemplates(): SnailTemplate[] {
    return this.repo.listTemplates();
  }

  findTemplateById(id: string): SnailTemplate | undefined {
    return this.repo.findTemplateById(id);
  }

  getSnailRuntime(templateId: string): SnailRuntimeInstance | undefined {
    const template = this.repo.findTemplateById(templateId);
    if (!template) return undefined;

    return {
      template,
      model: template.model,
      context_window: template.context_window ?? null,
      invocation_timeout_ms: template.invocation_timeout_ms ?? null,
    };
  }

  findCurrentSession(conversationId: string, roleName: string): SnailAgentSession | undefined {
    return this.repo.findCurrentSession(conversationId, roleName);
  }

  createSession(input: CreateSnailAgentSessionInput): SnailAgentSession {
    // 检查是否需要创建新 session（runtime/model 变更）
    const existingSession = this.repo.findCurrentSession(input.conversation_id, input.role_name);

    if (existingSession) {
      const runtimeChanged = existingSession.runtime !== input.runtime;
      const modelChanged = existingSession.model !== input.model;

      if (runtimeChanged || modelChanged) {
        // runtime/model 变更，创建新 session，handoff 指向旧 session
        return this.repo.createSession({
          ...input,
          handoff_from_id: existingSession.id,
        });
      }

      // 未变更，返回现有 session
      return existingSession;
    }

    // 首次调用，创建新 session
    return this.repo.createSession(input);
  }

  updateSessionExternalId(sessionId: string, externalSessionId: string): void {
    this.repo.updateSessionExternalId(sessionId, externalSessionId);
  }
}
