/**
 * ACS 运行时契约 — 定义 Snail Shell 与 Agent 运行时之间的调用协议。
 *
 * 覆盖两个场景：
 * - 首次调用（bootstrap）：external_session_id 为空，adapter 注入完整上下文
 * - 后续调用（resume）：external_session_id 有值，adapter 仅注入增量消息
 */

import type { AgentRuntime, AgentCapabilitySpec } from './types.js';
import type { AgentEvent } from './agent-event.js';

// ═══════════════════════════════════════════════════════════
// SnailRuntime 接口
// ═══════════════════════════════════════════════════════════

/** SnailRuntime 接口：所有运行时适配器必须实现 */
export interface SnailRuntime {
  /** 适配器名称 */
  name: string;
  /** 运行时类型 */
  runtime: AgentRuntime;
  /** 发送消息并接收流式事件 */
  invokeMessage(
    input: SnailRuntimeMessageInput,
    onEvent: (event: AgentEvent) => void,
    options?: AgentInvocationOptions,
  ): Promise<AgentInvocationResult>;
}

// ═══════════════════════════════════════════════════════════
// 调用输入（首次 + 后续统一）
// ═══════════════════════════════════════════════════════════

/** 运行时调用输入 — 覆盖首次调用和后续调用两个场景 */
export interface SnailRuntimeMessageInput {
  /** 工作区根目录绝对路径 */
  workspace_root: string;
  /** 对话 ID */
  conversation_id: string;
  /** 角色 key */
  role_key: string;

  // ─── 能力声明（完整，每次传入） ───

  /** 完整的 ACS 启动规格 */
  capability: AgentCapabilitySpec;

  // ─── 消息上下文 ───

  /**
   * 对话历史（截至 context cutoff）。
   * 首次调用：adapter 用于 bootstrap，注入 agent session。
   * 后续调用：adapter 忽略（agent session 已有完整上下文）。
   */
  history: AgentMessage[];
  /**
   * 本轮增量消息（inbox）。
   * 首次和后续调用都必须传入。
   */
  incrementalMessages: AgentMessage[];

  // ─── 会话恢复 ───

  /**
   * 外部会话 ID。
   * - undefined → 首次调用，adapter 执行 bootstrap
   * - 有值 → 后续调用，adapter 执行 resume（如 Claude Code --resume）
   */
  external_session_id?: string;
}

/** 消息（传给运行时的扁平化格式） */
export interface AgentMessage {
  /** 消息角色 */
  role: 'user' | 'assistant' | 'system';
  /** 消息内容 */
  content: string;
}

// ═══════════════════════════════════════════════════════════
// 调用结果与选项
// ═══════════════════════════════════════════════════════════

/** 运行时调用结果 */
export interface AgentInvocationResult {
  /** 有状态运行时返回的会话 ID（首次调用时由 agent 生成） */
  session_id?: string;
  /** 等待运行时停止的回调（shutdown 时确保子进程退出） */
  wait_for_stop: () => Promise<void>;
}

/** 运行时调用选项 */
export interface AgentInvocationOptions {
  /** 取消信号 */
  signal?: AbortSignal;
  /** 覆盖模型标识符 */
  model?: string;
  /** 覆盖上下文窗口大小 */
  context_window?: number;
  /** 覆盖调用超时时间（毫秒） */
  invocation_timeout_ms?: number;
}
