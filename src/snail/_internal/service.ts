/**
 * Snail 域服务实现。
 *
 * 外部禁止 import，通过 snail/api.ts 接口访问。
 * 启动时在 main.ts 中实例化并注入。
 */

import type { SnailService, SpecBuildContext } from '@/snail/api.js';
import type { SnailTemplate, AgentSession } from '@/snail/types.js';
import type { AgentCapabilitySpec } from '@/snail/acs/types.js';
import type {
  SnailRuntime,
  SnailRuntimeMessageInput,
  AgentInvocationResult,
  AgentInvocationOptions,
} from '@/snail/acs/runtime.js';
import type { AgentEvent } from '@/snail/acs/agent-event.js';
import type { SnailRepo } from '@/db/snail.repo.js';

export class SnailServiceImpl implements SnailService {
  constructor(private repo: SnailRepo) {}

  listTemplates(): SnailTemplate[] {
    return this.repo.listTemplates();
  }

  getTemplate(id: string): SnailTemplate | undefined {
    return this.repo.getTemplate(id);
  }

  resolveSpec(template: SnailTemplate, context: SpecBuildContext): AgentCapabilitySpec {
    return {
      runtime: template.runtime,
      model: template.model,
      systemPrompt: context.systemPrompt,
      systemReminder: context.systemReminder,
      skills: context.skills,
      mcpServers: context.mcpServers,
      guardProfile: context.guardProfile,
      context_window: template.context_window,
      invocation_timeout_ms: template.invocation_timeout_ms,
    };
  }

  invokeMessage(
    runtime: SnailRuntime,
    input: SnailRuntimeMessageInput,
    onEvent: (event: AgentEvent) => void,
    options?: AgentInvocationOptions,
  ): Promise<AgentInvocationResult> {
    return runtime.invokeMessage(input, onEvent, options);
  }

  getLatestSession(conversationId: string, roleKey: string): AgentSession | undefined {
    return this.repo.getLatestSession(conversationId, roleKey);
  }

  createSession(session: AgentSession): void {
    this.repo.createSession(session);
  }
}
