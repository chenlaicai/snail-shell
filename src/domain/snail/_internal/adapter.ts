import type { AgentEvent, InvokeResult, InvokeOptions, CapabilitiesSpec } from "@infra/acs/model";
import type { AgentRegistryPort } from "@infra/acs/port";
import { buildContextEnv } from "@infra/acs/_internal/utils/context-env";
import type { TenetPromptPort } from "@domain/tenet-prompt/port";
import type { SkillPort } from "@domain/skill/port";
import type { MCPPort } from "@domain/mcp/port";
import type { GuardProfilePort } from "@domain/guard-profile/port";
import type { Snail, SnailFirstCallRequest, SnailResumeRequest } from "@domain/snail/model";
import type { SnailPort } from "@domain/snail/port";
import type { SnailRepository } from "./repository";

/**
 * Snail 适配器实现。
 *
 * 管理 snail 配置，根据 snailId 创建 agent 实例并调用。
 * snail 是 agent 的上层封装，负责组装 tenet-prompt、skill、mcp、guard-profile 等。
 */
export class SnailAdapter implements SnailPort {
  /** 默认调用超时：120 分钟 */
  private static readonly DEFAULT_TIMEOUT_MS = 120 * 60 * 1000;

  constructor(
    private repo: SnailRepository,
    private registry: AgentRegistryPort,
    private tenetPrompt: TenetPromptPort,
    private skill: SkillPort,
    private mcp: MCPPort,
    private guardProfile: GuardProfilePort,
  ) {}

  list(): Snail[] {
    return this.repo.list();
  }

  async invokeFirstCall(
    snailId: string,
    request: SnailFirstCallRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    const snail = this.findSnailOrThrow(snailId);
    const agent = this.createAgent(snail);
    const workspace = { path: request.workspace_path, summary: null };

    // 组装 system prompt（tenet-prompt 按 tags 过滤）
    const systemPrompt = this.buildSystemPrompt(request.tags);

    // 组装 capabilities（skill + mcp）
    const capabilities = this.buildCapabilities(workspace);

    // 组装 guard profile（guard-profile 平台 + ws 合并）
    const guardProfile = this.buildGuardProfile(workspace);

    // 组装 system reminder（handbook + context 放入正确位置）
    const systemReminder = this.buildSystemReminder(request.handbook, request.context);

    // 组装环境变量（注入到 agent 进程的 process.env）
    const contextEnv = this.buildContextEnv(request);

    // 组装 invoke options（model, context_window, timeout, contextEnv）
    const invokeOptions = this.buildOptions(snail, options, contextEnv);

    // 调用底层 acs
    return agent.invokeFirstCall({
      prompt: { systemPrompt, systemReminder },
      capabilities,
      guardProfile,
      messages: request.messages,
      workspacePath: request.workspace_path,
    }, onEvent, invokeOptions);
  }

  async invokeResume(
    snailId: string,
    sessionId: string,
    request: SnailResumeRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    const snail = this.findSnailOrThrow(snailId);
    const agent = this.createAgent(snail);

    // 组装 invoke options（model, context_window, timeout）
    const invokeOptions = this.buildOptions(snail, options);

    // 调用底层 acs
    return agent.invokeResume(
      {
        sessionId,
        systemReminder: request.system_reminder ?? "",
        messages: request.messages,
        workspacePath: request.workspace_path,
      },
      onEvent,
      invokeOptions,
    );
  }

  // ── 组装逻辑 ──────────────────────────────────────────────────────

  /** 组装 system prompt（tenet-prompt 按 tags 过滤） */
  private buildSystemPrompt(tags?: string[]): string {
    const prompts = this.tenetPrompt.findByWorkspace({ path: "", summary: null }, tags);
    return prompts.map(p => p.content).join("\n\n");
  }

  /** 组装 capabilities（skill + mcp） */
  private buildCapabilities(workspace: { path: string; summary: null }): CapabilitiesSpec {
    const skills = this.skill.findByWorkspace(workspace);
    const mcpServers = this.mcp.findByWorkspace(workspace);

    return {
      skills: skills.map(s => ({
        name: s.name,
        description: s.description,
        filePath: `${s.dir_path}/SKILL.md`,
        directory: s.dir_path,
        content: s.content,
        source: s.scope,
      })),
      mcpServers: mcpServers.map(m => ({
        name: m.name,
        command: m.command,
        args: m.args,
        env: m.env,
        url: m.url,
      })),
    };
  }

  /** 组装 guard profile（guard-profile 平台 + ws 合并） */
  private buildGuardProfile(workspace: { path: string; summary: null }): { deny: string[]; allow: string[] } {
    const profile = this.guardProfile.findByWorkspace(workspace);
    return {
      deny: profile.deny,
      allow: profile.allow,
    };
  }

  /** 组装 system reminder（handbook + context 放入正确位置） */
  private buildSystemReminder(handbook?: string, context?: Record<string, unknown>): string {
    const parts: string[] = [];

    if (handbook) {
      parts.push(`<role-handbook>\n${handbook}\n</role-handbook>`);
    }

    if (context) {
      const contextLines = Object.entries(context)
        .filter(([, value]) => value != null)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join("\n");
      if (contextLines) {
        parts.push(`<invocation-context>\n${contextLines}\n</invocation-context>`);
      }
    }

    return parts.join("\n\n");
  }

  /** 组装 invoke options（model, context_window, timeout, contextEnv） */
  private buildOptions(snail: Snail, options: InvokeOptions, contextEnv: Record<string, string>): InvokeOptions {
    return {
      ...options,
      model: snail.model,
      contextWindow: snail.context_window,
      invocationTimeoutMs: snail.invocation_timeout_ms ?? SnailAdapter.DEFAULT_TIMEOUT_MS,
      contextEnv,
    };
  }

  /** 组装环境变量（注入到 agent 进程的 process.env） */
  private buildContextEnv(request: SnailFirstCallRequest): Record<string, string> {
    return buildContextEnv({
      workspacePath: request.workspace_path,
      context: request.context,
    });
  }

  // ── 辅助方法 ──────────────────────────────────────────────────────

  /** 查找 snail 配置，不存在则抛异常 */
  private findSnailOrThrow(snailId: string): Snail {
    const snail = this.repo.findById(snailId);
    if (!snail) {
      throw new Error(`Snail not found: ${snailId}`);
    }
    return snail;
  }

  /** 根据 snail 配置创建 agent 实例 */
  private createAgent(snail: Snail) {
    const AgentClass = this.registry.getAgentRuntimeClass(snail.agent_name);
    if (!AgentClass) {
      throw new Error(`Agent runtime not found: ${snail.agent_name}`);
    }
    return new AgentClass();
  }
}
