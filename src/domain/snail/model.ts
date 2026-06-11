import type { Message } from "@domain/acs/model";

/**
 * Snail — AI Agent 运行时配置。
 *
 * 一个 Snail 绑定了 agent 实现和 model 配置，
 * 是"一个可调用的 AI Agent"的完整声明。
 */
export interface Snail {
  /** Snail 唯一标识，如 "claude-code-sonnet" */
  id: string;
  /** 显示名称，如 "Claude Code + Sonnet" */
  name: string;
  /** 对应 acs agent 的 name，如 "claude-code" */
  agent_name: string;
  /** 模型标识，如 "sonnet", "my-geek/gpt-5.5" */
  model: string;
  /** 上下文窗口大小（token 数），用于 runtime 未返回时的兜底 */
  context_window?: number;
  /** 调用超时（毫秒），默认 120 分钟 */
  invocation_timeout_ms?: number;
}

/** Snail 首次调用请求 */
export interface SnailFirstCallRequest {
  /** 工作目录 */
  workspace_root: string;
  /** 对话历史 */
  messages: Message[];
  /** 用于过滤 tenet-prompt 的标签 */
  tags?: string[];
  /** role handbook 内容 */
  handbook?: string;
  /** 业务上下文标识（conversation_id, message_id 等），由 snail 塞入 system-reminder */
  context?: Record<string, string>;
}

/** Snail 后续调用请求 */
export interface SnailResumeRequest {
  /** 工作目录 */
  workspace_root: string;
  /** 增量消息 */
  messages: Message[];
  /** 动态上下文 */
  system_reminder?: string;
}
