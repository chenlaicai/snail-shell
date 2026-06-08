/**
 * Snail 域公开 API — 接口层。
 *
 * 调用方只 import 本文件，不关心实现细节。
 * 实现在 _internal/service.ts，启动时绑定。
 */

import type { SnailTemplate, AgentSession } from '@/snail/types.js';
import type { AgentCapabilitySpec, SkillCapability, McpServerCapability, GuardProfile } from '@/snail/acs/types.js';
import type {
  SnailRuntime,
  SnailRuntimeMessageInput,
  AgentInvocationResult,
  AgentInvocationOptions,
} from '@/snail/acs/runtime.js';
import type { AgentEvent } from '@/snail/acs/agent-event.js';

/** resolveSpec 的上下文参数 — 由 ConversationService 在编排时提供 */
export interface SpecBuildContext {
  /** 系统提示词（静态规则，整场对话不变） */
  systemPrompt: string;
  /** 系统提示词（动态运行时上下文，每次调用传入） */
  systemReminder: string;
  /** 当前可用的 skill 列表 */
  skills: SkillCapability[];
  /** 当前可用的 MCP 服务器列表 */
  mcpServers: McpServerCapability[];
  /** 安全守护策略 */
  guardProfile: GuardProfile;
}

/** Snail 域服务接口 */
export interface SnailService {
  /** 列出所有可用的 Snail 模板 */
  listTemplates(): SnailTemplate[];

  /** 按 ID 获取模板 */
  getTemplate(id: string): SnailTemplate | undefined;

  /** 解析模板 + 运行时上下文为完整的 ACS 启动规格 */
  resolveSpec(template: SnailTemplate, context: SpecBuildContext): AgentCapabilitySpec;

  /** 调用 Agent 运行时发送消息 */
  invokeMessage(
    runtime: SnailRuntime,
    input: SnailRuntimeMessageInput,
    onEvent: (event: AgentEvent) => void,
    options?: AgentInvocationOptions,
  ): Promise<AgentInvocationResult>;

  /** 获取指定对话+角色的最新会话 */
  getLatestSession(conversationId: string, roleKey: string): AgentSession | undefined;

  /** 创建会话 */
  createSession(session: AgentSession): void;
}
