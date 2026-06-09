/**
 * LLM 模块
 *
 * 提供 LLM 调用、摘要、mention 提取的领域功能。
 *
 * 架构说明：
 * - types: 公开类型定义
 * - client: Client 接口定义
 * - internal: 私有实现（在 database 模块中）
 *
 * 依赖倒置：
 * - 本模块定义 Client 接口
 * - database 模块实现这些接口
 * - 本模块通过接口访问 LLM
 */

// ═══ 公开类型 ═══
export type {
  ChatMessage,
  ChatMessageRole,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatChoice,
  Usage,
  SummaryInput,
  Mention,
  LlmConfig,
} from "./types";

// ═══ Client 接口 ═══
export type { LlmClient, LlmClientFactory } from "./client";
