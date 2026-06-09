/**
 * LLM 模块公开类型
 *
 * 定义 LLM 调用、摘要、mention 提取的领域类型。
 *
 * 设计原则：
 * - 只定义本模块的领域类型
 * - 不依赖其他模块的类型
 * - 通过 Client 接口访问 LLM
 */

/**
 * Chat 消息角色
 */
export type ChatMessageRole = "system" | "user" | "assistant";

/**
 * Chat 消息
 */
export interface ChatMessage {
  /** 消息角色 */
  role: ChatMessageRole;
  /** 消息内容 */
  content: string;
}

/**
 * Chat Completion 请求
 */
export interface ChatCompletionRequest {
  /** 模型名称 */
  model: string;
  /** 消息列表 */
  messages: ChatMessage[];
  /** 温度参数 */
  temperature?: number;
  /** 最大 token 数 */
  max_tokens?: number;
}

/**
 * Chat Choice
 */
export interface ChatChoice {
  /** 选择索引 */
  index: number;
  /** 消息 */
  message: ChatMessage;
  /** 完成原因 */
  finish_reason: string;
}

/**
 * Usage 信息
 */
export interface Usage {
  /** 提示 token 数 */
  prompt_tokens: number;
  /** 完成 token 数 */
  completion_tokens: number;
  /** 总 token 数 */
  total_tokens: number;
}

/**
 * Chat Completion 响应
 */
export interface ChatCompletionResponse {
  /** 响应 ID */
  id: string;
  /** 选择列表 */
  choices: ChatChoice[];
  /** Usage 信息 */
  usage: Usage;
}

/**
 * 摘要输入
 */
export interface SummaryInput {
  /** 会话 ID */
  conversationId: string;
  /** 消息列表 */
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  /** 目标字符数 */
  targetChars: number;
}

/**
 * Mention
 */
export interface Mention {
  /** 名称 */
  name: string;
  /** 置信度 */
  confidence: number;
}

/**
 * LLM 配置
 */
export interface LlmConfig {
  /** API Key */
  apiKey: string;
  /** 模型名称 */
  model: string;
  /** Base URL */
  baseUrl: string;
  /** 超时时间（毫秒） */
  timeoutMs: number;
}
