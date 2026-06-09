/**
 * Conversation 模块
 *
 * 提供会话、消息、事件的领域功能。
 *
 * 架构说明：
 * - types: 公开类型定义
 * - repository: Repository 接口定义
 * - utils: 工具函数
 * - internal: 私有实现（在 database 模块中）
 *
 * 依赖倒置：
 * - 本模块定义 Repository 接口
 * - database 模块实现这些接口
 * - 本模块通过接口访问数据库
 */

// ═══ 公开类型 ═══
export type {
  Message,
  MessageEvent,
  MessageContext,
  Conversation,
  MessageDispatch,
  CreateMessageInput,
  CreateMessageEventInput,
  CreateConversationInput,
  CreateMessageDispatchInput,
  MessageRole,
  MessageStatus,
  ConversationKind,
  ConversationStatus,
  MessageEventKind,
  MessageEventCategory,
} from "./types";

// ═══ 消息内容块类型 ═══
export type {
  MessageTextBlock,
  MessageRichTextBlock,
  MessageMarkdownBlock,
  MessageImageBlock,
  MessageIconBlock,
  MessageChartBlock,
  MessageTableBlock,
  MessageToolCallCardBlock,
  MessageArtifactCardBlock,
  MessageReferenceCardBlock,
  QuestionOptionPayload,
  QuestionResponseSelectedOptionPayload,
  MessageQuestionBlock,
  MessageQuestionResponseBlock,
  MessageContentBlock,
} from "./types/content-blocks";

// ═══ 事件相关类型 ═══
export type {
  MessageRuntime,
  MessageSignalType,
  MessageContextKind,
  MessageDispatchStatus,
  ConversationOwnerType,
  MessageEventSource,
  StartEventPayload,
  TextEventPayload,
  ContentBlockEventPayload,
  ToolCallEventPayload,
  ToolResultEventPayload,
  CommandEventPayload,
  CommandResultEventPayload,
  SignalEventPayload,
  ErrorEventPayload,
  MessageEventPayload,
  DispatchInboxGroup,
  DispatchInboxPreviewItem,
  ConversationHistorySearchResult,
  MessageContextSummaryInput,
  MessageContextSummaryGenerator,
} from "./types/events";

// ═══ 工具函数 ═══
export { extractTextFromBlocks, extractEventText } from "./utils/event-content";
export { formatMessageContextForPrompt } from "./utils/message-context";

// ═══ Repository 接口 ═══
export type { ConversationRepository } from "./repository";
