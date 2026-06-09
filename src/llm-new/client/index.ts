/**
 * LLM Client 接口
 *
 * 定义 LLM 客户端的接口。
 *
 * 设计原则：
 * - 接口定义在原子模块中
 * - 实现在 database 模块中
 * - 原子模块通过接口访问 LLM
 */

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  SummaryInput,
  Mention,
  LlmConfig,
} from "../types";

/**
 * LLM Client 接口
 *
 * 定义 LLM 客户端的操作。
 */
export interface LlmClient {
  /**
   * Chat Completion
   * @param request 请求
   * @returns 响应
   */
  chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;

  /**
   * 生成摘要
   * @param input 摘要输入
   * @returns 摘要文本
   */
  generateSummary(input: SummaryInput): Promise<string>;

  /**
   * 提取 Mention
   * @param text 文本
   * @returns Mention 列表
   */
  extractMentions(text: string): Promise<Mention[]>;
}

/**
 * LLM Client Factory 接口
 *
 * 定义 LLM 客户端工厂的操作。
 */
export interface LlmClientFactory {
  /**
   * 创建 LLM 客户端
   * @param config LLM 配置
   * @returns LLM 客户端
   */
  create(config: LlmConfig): LlmClient;
}
