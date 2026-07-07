import type {
  Message,
  MessageStatus,
  CreateMessageInput,
  MessageEvent,
  MessageEventPayload,
  MessageContext,
  MessageContextKind,
} from "@domain/message/model";

/** 消息端口 */
export interface MessagePort {
  // Message CRUD
  createMessage(input: CreateMessageInput): Message;
  getMessage(id: number): Message | undefined;
  /** 查询 stage 中消息，默认返回最新 limit 条（DESC）；beforeId 用于加载更早消息 */
  listMessages(stageId: string, limit?: number, beforeId?: number): Message[];
  /** 窗口查询：返回锚点消息前后各 N 条（按 id ASC） */
  listMessagesWindow(stageId: string, anchorId: number, before: number, after: number): Message[];
  /** 跨 stage 关键词搜索 message_context（SQL LIKE），返回匹配的 {message, context} */
  searchContext(stageId: string, query: string, limit: number): Array<{ message: Message; context: MessageContext }>;
  listMessagesByStatus(status: MessageStatus, limit?: number): Message[];
  updateMessageTargets(messageId: number, toSpeakers: string[]): void;

  /** 完成消息：追加终态信号事件 + 更新状态（原子操作） */
  completeMessage(messageId: number, status: MessageStatus, signalPayload?: Record<string, unknown>): void;

  // Event
  appendEvent(messageId: number, payload: MessageEventPayload): MessageEvent;
  getMessageEvents(messageId: number): MessageEvent[];

  // Context
  getContext(messageId: number): MessageContext | null;
  setContext(messageId: number, kind: MessageContextKind, context: string): void;

  // ReadCursor
  getCursor(stageId: string, speaker: string): number;
  advanceCursor(stageId: string, speaker: string, messageId: number): void;
  getUnreadMessages(stageId: string, speaker: string): Message[];
  initCursor(stageId: string, speaker: string): void;

  /** 查找最近响应的 speaker（最近一条 assistant 消息的 from_speaker） */
  findLatestRespondingSpeaker(stageId: string): string | null;

  /** 查找 stage 中最新一条消息 */
  findLatestMessage(stageId: string): Message | undefined;

  /** 查找 stage 中指定 speaker 的最新一条消息（并发安全） */
  findLatestMessageBySpeaker(stageId: string, fromSpeaker: string): Message | undefined;

  /** 查找 issue 所有 stage 中最新一条消息（按 id DESC LIMIT 1，跨 stage JOIN） */
  findLatestMessageByIssueId(issueId: string): Message | undefined;
}
