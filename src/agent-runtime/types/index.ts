/**
 * Agent Runtime 模块公开类型
 *
 * 定义 Agent 运行时适配、进程管理的领域类型。
 *
 * 设计原则：
 * - 只定义本模块的领域类型
 * - 不依赖其他模块的类型
 * - 通过 Resolver 接口访问运行时
 */

/**
 * Agent 运行时类型
 */
export type AgentRuntimeType = "claude-code" | "claude-code-stateful" | "opencode" | "codex";

/**
 * Agent 运行时实体
 */
export interface AgentRuntime {
  /** 运行时 ID */
  id: string;
  /** 运行时名称 */
  name: string;
  /** 运行时类型 */
  type: "stateless" | "stateful";
}

/**
 * Agent 调用选项
 */
export interface AgentInvocationOptions {
  /** 中断信号 */
  signal?: AbortSignal;
  /** 模型标识 */
  model?: string;
  /** 上下文窗口大小 */
  contextWindow?: number;
  /** 调用超时（毫秒） */
  invocationTimeoutMs?: number;
  /** 运行时上下文环境变量 */
  contextEnv?: Record<string, string>;
}

/**
 * Agent 调用结果
 */
export interface AgentInvocationResult {
  /** 会话 ID */
  sessionId?: string | null;
  /** 等待停止函数 */
  waitForStop?: () => Promise<void>;
}

/**
 * Agent 事件类型
 */
export type AgentEventType =
  | "message_event"
  | "permission_required"
  | "message_failure";

/**
 * Agent 事件
 */
export interface AgentEvent {
  /** 事件类型 */
  type: AgentEventType;
  /** 事件数据 */
  data: Record<string, unknown>;
}

/**
 * Agent 消息
 */
export interface AgentMessage {
  /** 消息角色 */
  role: "user" | "assistant";
  /** 消息内容 */
  content: string;
}

/**
 * Agent 调用输入
 */
export interface AgentInvocationInput {
  /** 系统提示词 */
  systemPrompt: string;
  /** 系统提醒 */
  systemReminder: string;
  /** 消息列表 */
  messages: AgentMessage[];
}

/**
 * Snail Runtime 接口
 *
 * 定义 Agent 运行时的核心操作。
 */
export interface SnailRuntime {
  /** 运行时名称 */
  readonly name: string;
  /** 运行时类型 */
  readonly runtime: AgentRuntime;

  /**
   * 调用消息
   * @param input 调用输入
   * @param onEvent 事件回调
   * @param options 调用选项
   * @returns 调用结果
   */
  invokeMessage(
    input: AgentInvocationInput,
    onEvent: (event: AgentEvent) => void,
    options?: AgentInvocationOptions
  ): Promise<AgentInvocationResult>;
}
