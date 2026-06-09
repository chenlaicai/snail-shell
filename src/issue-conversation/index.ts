/**
 * Issue Conversation 业务场景模块
 *
 * 编排多个原子模块完成 Issue 对话场景。
 *
 * 架构说明：
 * - types: 业务场景类型定义
 * - orchestrator: 编排器接口和实现
 * - internal: 私有实现
 *
 * 依赖的原子模块：
 * - conversation: 会话、消息、事件
 * - workspace: 工作区、Issue、Stage
 * - agent-runtime: Agent 运行时
 * - prompt: 提示词构建
 * - sop: SOP 模板、转移规则
 */

// ═══ 公开类型 ═══
export type {
  SendMessageResult,
  StageTransition,
  ConversationStatus,
  IssueConversationOrchestrator,
} from "./types";

// ═══ 编排器实现 ═══
export { IssueConversationOrchestratorImpl } from "./orchestrator";
