import { randomBytes } from "crypto";
import type { AgentEvent, InvokeOptions, CapabilitiesSpec } from "@infra/acs/model";
import type { AgentRegistryPort } from "@infra/acs/port";
import { buildContextEnv } from "@infra/acs/_internal/utils/context-env";
import type { TenetPromptPort } from "@domain/tenet-prompt/port";
import type { SkillPort } from "@domain/skill/port";
import type { MCPPort } from "@domain/mcp/port";
import type { GuardProfilePort } from "@domain/guard-profile/port";
import type { Snail, SnailFirstCallRequest, SnailResumeRequest, SnailInstance, SnailInvokeResult } from "@domain/snail/model";
import type { SnailPort } from "@domain/snail/port";
import type { SnailRepository } from "./repository";

/**
 * Snail 适配器实现。
 *
 * 管理 snail 配置和 snail 实例。
 * 调用方通过 snail_instance_id 追踪会话，不感知底层 agent session。
 */
export class SnailAdapter implements SnailPort {
  private static readonly DEFAULT_TIMEOUT_MS = 120 * 60 * 1000;

  /** snail 实例存储（内存） */
  private instances = new Map<string, SnailInstance>();

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
    snailKey: string,
    request: SnailFirstCallRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<SnailInvokeResult> {
    const snail = this.findSnailOrThrow(snailKey);
    const agent = this.createAgent(snail);

    // 创建 snail 实例
    const instanceId = this.generateInstanceId(snailKey);
    const instance: SnailInstance = {
      id: instanceId,
      snail_key: snailKey,
      session_ids: [],
      created_at: new Date().toISOString(),
    };
    this.instances.set(instanceId, instance);

    // 组装调用参数
    const workspace = { path: request.workspace_path, summary: null };
    const systemPrompt = this.buildSystemPrompt(request.tags);
    const capabilities = this.buildCapabilities(workspace);
    const guardProfile = this.buildGuardProfile(workspace);
    const systemReminder = this.buildSystemReminder(request.handbook, request.context);
    const contextEnv = this.buildContextEnv(request);
    const invokeOptions = this.buildOptions(snail, options, contextEnv);

    // 调用 agent
    const result = await agent.invokeFirstCall({
      prompt: { systemPrompt, systemReminder },
      capabilities,
      guard_profile: guardProfile,
      messages: request.messages,
      workspacePath: request.workspace_path,
    }, onEvent, invokeOptions);

    // 记录 session_id
    if (result.sessionId) {
      instance.session_ids.push(result.sessionId);
    }

    return { snail_instance_id: instanceId };
  }

  async invokeResume(
    snailInstanceId: string,
    request: SnailResumeRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<SnailInvokeResult> {
    const instance = this.instances.get(snailInstanceId);
    if (!instance) throw new Error(`Snail instance not found: ${snailInstanceId}`);

    const snail = this.findSnailOrThrow(instance.snail_key);
    const agent = this.createAgent(snail);
    const sessionId = instance.session_ids.at(-1);
    if (!sessionId) throw new Error(`No session to resume for instance: ${snailInstanceId}`);

    const invokeOptions = this.buildOptions(snail, options);

    const result = await agent.invokeResume(
      { sessionId, systemReminder: request.system_reminder ?? "", messages: request.messages, workspacePath: request.workspace_path },
      onEvent,
      invokeOptions,
    );

    // 记录新 session_id
    if (result.sessionId && result.sessionId !== sessionId) {
      instance.session_ids.push(result.sessionId);
    }

    return { snail_instance_id: snailInstanceId };
  }

  // ── 辅助方法 ──────────────────────────────────────────────────────

  /** snail_key + "#" + 6位随机字符 */
  private generateInstanceId(snailKey: string): string {
    const suffix = randomBytes(3).toString("hex").slice(0, 6);
    return `${snailKey}#${suffix}`;
  }

  private findSnailOrThrow(snailKey: string): Snail {
    const snail = this.repo.findByKey(snailKey);
    if (!snail) throw new Error(`Snail not found: ${snailKey}`);
    return snail;
  }

  private createAgent(snail: Snail) {
    const AgentClass = this.registry.getAgentRuntimeClass(snail.agent_name);
    if (!AgentClass) throw new Error(`Agent runtime not found: ${snail.agent_name}`);
    return new AgentClass();
  }

  private buildSystemPrompt(tags?: string[]): string {
    const prompts = this.tenetPrompt.findByWorkspace({ path: "", summary: null }, tags);
    return prompts.map(p => p.content).join("\n\n");
  }

  private buildCapabilities(workspace: { path: string; summary: null }): CapabilitiesSpec {
    const skills = this.skill.findByWorkspace(workspace);
    const mcpServers = this.mcp.findByWorkspace(workspace);
    return {
      skills: skills.map(s => ({ name: s.name, description: s.description, filePath: `${s.dir_path}/SKILL.md`, directory: s.dir_path, content: s.content, source: s.scope })),
      mcpServers: mcpServers.map(m => ({ name: m.name, command: m.command, args: m.args, env: m.env, url: m.url })),
    };
  }

  private buildGuardProfile(workspace: { path: string; summary: null }) {
    const profile = this.guardProfile.findByWorkspace(workspace);
    return { deny: profile.deny, allow: profile.allow };
  }

  private buildSystemReminder(handbook?: string, context?: Record<string, unknown>): string {
    const parts: string[] = [];
    if (handbook) parts.push(`<role-handbook>\n${handbook}\n</role-handbook>`);
    if (context) {
      const lines = Object.entries(context).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${String(v)}`).join("\n");
      if (lines) parts.push(`<invocation-context>\n${lines}\n</invocation-context>`);
    }
    return parts.join("\n\n");
  }

  private buildOptions(snail: Snail, options: InvokeOptions, contextEnv?: Record<string, string>): InvokeOptions {
    return { ...options, model: snail.model, contextWindow: snail.context_window, invocationTimeoutMs: snail.invocation_timeout_ms ?? SnailAdapter.DEFAULT_TIMEOUT_MS, ...(contextEnv ? { contextEnv } : {}) };
  }

  private buildContextEnv(request: SnailFirstCallRequest): Record<string, string> {
    return buildContextEnv({ workspacePath: request.workspace_path, context: request.context });
  }
}
