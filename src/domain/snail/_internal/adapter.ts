import assert from "node:assert";
import { randomBytes } from "crypto";
import type { AgentEvent, InvokeOptions, CapabilitiesSpec } from "@infra/acs/model";
import type { AgentRegistryPort } from "@infra/acs/port";
import { buildContextEnv } from "@infra/acs/_internal/utils/context-env";
import { CONTEXT_KEYS } from "@infra/acs/context-keys";
import type { TenetPromptPort } from "@domain/tenet-prompt/port";
import type { SkillPort } from "@domain/skill/port";
import type { MCPPort } from "@domain/mcp-config/port";
import type { GuardProfilePort } from "@domain/guard-profile/port";
import type { Snail, SnailFirstCallRequest, SnailResumeRequest, SnailInstance, SnailInvokeResult } from "@domain/snail/model";
import type { SnailPort } from "@domain/snail/port";
import type { SnailRepository } from "@domain/snail/_internal/repository";
import { Semaphore } from "@infra/semaphore";
import { getLogger } from "@infra/logger";

const log = getLogger({ module: "snail" });

export interface SnailAdapterDeps {
  repo: SnailRepository;
  registry: AgentRegistryPort;
  tenetPrompt: TenetPromptPort;
  skill: SkillPort;
  mcp: MCPPort;
  guardProfile: GuardProfilePort;
}

/**
 * Snail 适配器实现。
 *
 * 管理 snail 配置和 snail 实例。
 * 调用方通过 snail_instance_id 追踪会话，不感知底层 agent session。
 */
export class SnailAdapter implements SnailPort {
  private static readonly DEFAULT_TIMEOUT_MS = 120 * 60 * 1000;
  private readonly repo: SnailRepository;
  private readonly registry: AgentRegistryPort;
  private readonly tenetPrompt: TenetPromptPort;
  private readonly skill: SkillPort;
  private readonly mcp: MCPPort;
  private readonly guardProfile: GuardProfilePort;
  private readonly agentSemaphore: Semaphore;

  constructor(deps: SnailAdapterDeps, maxConcurrentAgents = 3) {
    this.repo = deps.repo;
    this.registry = deps.registry;
    this.tenetPrompt = deps.tenetPrompt;
    this.skill = deps.skill;
    this.mcp = deps.mcp;
    this.guardProfile = deps.guardProfile;
    this.agentSemaphore = new Semaphore(maxConcurrentAgents);
  }

  list(): Snail[] {
    return this.repo.list();
  }

  findByKey(key: string): Snail | undefined {
    return this.repo.findByKey(key);
  }

  create(snail: Snail): Snail {
    this.repo.create(snail);
    return snail;
  }

  update(key: string, patch: Partial<Omit<Snail, 'key'>>): Snail {
    return this.repo.update(key, patch);
  }

  remove(key: string): void {
    const instanceCount = this.repo.countInstancesByKey(key);
    const stageRefCount = this.repo.countActiveStageReferencesByKey(key);
    if (instanceCount > 0 || stageRefCount > 0) {
      throw new Error(
        `Cannot delete snail '${key}': ${instanceCount} instance(s) and ${stageRefCount} in-progress stage(s) reference it`,
      );
    }
    this.repo.remove(key);
  }

  async invokeFirstCall(
    snailKey: string,
    request: SnailFirstCallRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<SnailInvokeResult> {
    const release = await this.agentSemaphore.acquire("global");
    try {
      return await this.doInvokeFirstCall(snailKey, request, onEvent, options);
    } finally {
      release();
    }
  }

  private async doInvokeFirstCall(
    snailKey: string,
    request: SnailFirstCallRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<SnailInvokeResult> {
    const snail = this.findSnailOrThrow(snailKey);
    const agent = this.createAgent(snail);

    log.info({
      snailKey, agentName: snail.agent_name, model: snail.model,
      messageCount: request.messages.length, workspacePath: request.workspace_path,
    }, "invokeFirstCall");

    // 创建 snail 实例
    const instanceId = this.generateInstanceId(snailKey);
    const instance: SnailInstance = {
      id: instanceId,
      snail_key: snailKey,
      session_ids: [],
      created_at: new Date().toISOString(),
    };
    this.repo.createInstance(instance);

    // 组装调用参数
    const workspace = { path: request.workspace_path, summary: null };
    assert(!snail.name.includes('」'), `snail.name 包含非法字符「」」，请检查 snails.json 配置`);
    const systemPrompt = this.buildSystemPrompt(request.tags);
    const capabilities = this.buildCapabilities(workspace);
    const guardProfile = this.buildGuardProfile(workspace);
    const systemReminder = this.buildSystemReminder(request.systemReminder);
    const contextEnv = this.buildContextEnv(request);
    const invokeOptions = this.buildOptions(snail, options, contextEnv);

    // 调用 agent
    const result = await agent.invokeFirstCall({
      prompt: { systemPrompt, systemReminder },
      capabilities,
      guard_profile: guardProfile,
      messages: request.messages,
      workspacePath: request.workspace_path,
      snailKey,
      messageId: request.context?.message_id != null ? String(request.context.message_id) : undefined,
    }, onEvent, invokeOptions);

    // 记录 session_id
    if (result.sessionId) {
      instance.session_ids.push(result.sessionId);
      this.repo.updateInstanceSessionIds(instance.id, instance.session_ids);
    }

    log.info({ snailKey, instanceId, sessionId: result.sessionId }, "invokeFirstCall completed");

    return { snail_instance_id: instanceId };
  }

  async invokeResume(
    snailInstanceId: string,
    request: SnailResumeRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<SnailInvokeResult> {
    const release = await this.agentSemaphore.acquire("global");
    try {
      return await this.doInvokeResume(snailInstanceId, request, onEvent, options);
    } finally {
      release();
    }
  }

  private async doInvokeResume(
    snailInstanceId: string,
    request: SnailResumeRequest,
    onEvent: (event: AgentEvent) => void,
    options: InvokeOptions = {},
  ): Promise<SnailInvokeResult> {
    const instance = this.repo.findInstanceById(snailInstanceId);
    if (!instance) throw new Error(`Snail instance not found: ${snailInstanceId}`);

    const snail = this.findSnailOrThrow(instance.snail_key);
    const agent = this.createAgent(snail);
    const sessionId = instance.session_ids.at(-1);
    if (!sessionId) throw new Error(`No session to resume for instance: ${snailInstanceId}`);

    log.info({
      snailInstanceId, snailKey: instance.snail_key, agentName: snail.agent_name,
      sessionId, messageCount: request.messages.length,
    }, "invokeResume");

    const contextEnv: Record<string, string> = { [CONTEXT_KEYS.WORKSPACE_PATH]: request.workspace_path, snail_key: instance.snail_key };
    if (request.messageId != null) contextEnv[CONTEXT_KEYS.MESSAGE_ID] = request.messageId;
    if (request.stageId != null) contextEnv[CONTEXT_KEYS.STAGE_ID] = request.stageId;
    const invokeOptions = this.buildOptions(snail, options, contextEnv);

    const result = await agent.invokeResume(
      { sessionId, systemReminder: request.system_reminder ?? "", messages: request.messages, workspacePath: request.workspace_path, snailKey: instance.snail_key, messageId: request.messageId },
      onEvent,
      invokeOptions,
    );

    // 记录新 session_id
    if (result.sessionId && result.sessionId !== sessionId) {
      instance.session_ids.push(result.sessionId);
      this.repo.updateInstanceSessionIds(instance.id, instance.session_ids);
    }

    log.info({ snailInstanceId, sessionId: result.sessionId }, "invokeResume completed");

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

  private buildSystemReminder(systemReminder?: string): string {
    // 直接透传collaboration的完整输出，不做任何处理
    return systemReminder ?? "";
  }

  private buildOptions(snail: Snail, options: InvokeOptions, contextEnv?: Record<string, string>): InvokeOptions {
    return { ...options, model: snail.model, contextWindow: snail.context_window, invocationTimeoutMs: snail.invocation_timeout_ms ?? SnailAdapter.DEFAULT_TIMEOUT_MS, ...(contextEnv ? { contextEnv } : {}) };
  }

  private buildContextEnv(request: SnailFirstCallRequest): Record<string, string> {
    return buildContextEnv({ workspacePath: request.workspace_path, context: request.context });
  }
}
