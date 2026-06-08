/**
 * ACS AgentEvent 模型 — Agent 运行时输出的流式事件。
 *
 * 使用 discriminated union 替代旧的扁平 MessageEventKind + payload: unknown 模型。
 * 每个事件类型有明确的 payload 结构，消费者可直接窄化类型。
 */

import type { AgentRuntime } from './types.js';

// ═══════════════════════════════════════════════════════════
// AgentEvent 联合类型
// ═══════════════════════════════════════════════════════════

/** 从运行时流向 Snail Shell 的事件 */
export type AgentEvent =
  | StartEvent
  | TextEvent
  | ToolCallEvent
  | ToolResultEvent
  | SignalEvent
  | ErrorEvent;

// ─── 事件类型定义 ───

/** 消息流开始 */
export interface StartEvent {
  type: 'start';
  /** 运行时类型 */
  runtime: AgentRuntime;
  /** 运行时会话 ID */
  session_id?: string;
}

/** 文本片段 */
export interface TextEvent {
  type: 'text';
  /** 文本内容 */
  text: string;
}

/** 工具调用请求 */
export interface ToolCallEvent {
  type: 'tool_call';
  /** 工具名称 */
  tool_name: string;
  /** 工具调用 ID */
  tool_call_id: string;
  /** 调用参数 */
  arguments?: unknown;
}

/** 工具调用结果 */
export interface ToolResultEvent {
  type: 'tool_result';
  /** 对应的工具调用 ID */
  tool_call_id: string;
  /** 调用结果 */
  result: unknown;
  /** 是否为错误结果 */
  is_error?: boolean;
}

/** 运行时信号（生命周期、使用量等） */
export interface SignalEvent {
  type: 'signal';
  /** 信号类型 */
  signal: SignalKind;
  /** 信号附加数据（结构由 signal 决定） */
  data?: unknown;
}

/** 运行时错误 */
export interface ErrorEvent {
  type: 'error';
  /** 错误信息 */
  message: string;
  /** 错误码 */
  code?: string;
}

// ═══════════════════════════════════════════════════════════
// Signal 类型
// ═══════════════════════════════════════════════════════════

/** 信号类型 */
export type SignalKind =
  | 'step_start'
  | 'step_finish'
  | 'turn_started'
  | 'turn_completed'
  | 'runtime_usage'
  | 'message_completed'
  | 'message_failed'
  | 'message_interrupted'
  | 'message_cancelled'
  | 'permission_blocked'
  | 'message_pending_approval';

/** runtime_usage 信号的数据结构 */
export interface RuntimeUsageData {
  /** 输入 token 数 */
  input_tokens?: number;
  /** 输出 token 数 */
  output_tokens?: number;
  /** 缓存创建 token 数 */
  cache_creation_input_tokens?: number;
  /** 缓存读取 token 数 */
  cache_read_input_tokens?: number;
  /** 总费用（美元） */
  total_cost_usd?: number;
  /** 总耗时（毫秒） */
  duration_ms?: number;
  /** API 耗时（毫秒） */
  duration_api_ms?: number;
}
