/**
 * Issue Conversation 业务场景类型
 *
 * 定义 Issue 对话场景的领域类型。
 *
 * 设计原则：
 * - 只定义本业务场景的类型
 * - 依赖原子模块的公开类型
 * - 通过编排器协调多个原子模块
 */

import type { Message, Conversation } from "../../conversation";
import type { Issue, Stage } from "../../workspace";
import type { SopTransition } from "../../sop";

/**
 * 发送消息结果
 */
export interface SendMessageResult {
  /** 用户消息 */
  message: Message;
  /** AI 响应 */
  response: Message;
  **Stage 转移信息
  stageTransition?: StageTransition;
}

/**
 * Stage 转移信息
 */
export interface StageTransition {
  **源 Stage 标识符
  from: string;
  **目标 Stage 标识符
  to: string;
  **转移原因
  reason: string;
}

/**
 * 对话状态
 */
export interface ConversationStatus {
  **Issue ID
  issueId: string;
  **当前 Stage
  currentStage: Stage | null;
  **当前 Conversation
  currentConversation: Conversation | null;
  **消息数量
  messageCount: number;
  **是否可以转移 Stage
  canTransition: boolean;
}

/**
 * Issue Conversation 编排器接口
 *
 * 定义 Issue 对话场景的核心操作。
 */
export interface IssueConversationOrchestrator {
  /**
   * 发送消息
   * @param issueId Issue ID
   * @param content 消息内容
   * @returns 发送结果
   */
  sendMessage(issueId: string, content: string): Promise<SendMessageResult>;

  /**
   * 获取对话历史
   * @param issueId Issue ID
   * @param limit 限制数量
   * @returns 消息列表
   */
  getHistory(issueId: string, limit?: number): Promise<Message[]>;

  /**
   * 获取对话状态
   * @param issueId Issue ID
   * @returns 对话状态
   */
  getConversationStatus(issueId: string): Promise<ConversationStatus>;
}
