import type {
  Conversation,
  Message,
  MessageEvent,
  MessageContext,
  MessageDispatch,
  CreateConversationInput,
  CreateMessageInput,
  MessageContextKind,
  MessageDispatchStatus,
  IMChannelConfig,
  LobbySession,
} from "@domain/im/model";

/** IM 持久层接口 */
export interface IMRepository {
  // 会话
  findConversationById(id: string): Conversation | undefined;
  listConversations(filters?: { workspace_id?: string; issue_id?: string; stage_id?: string; limit?: number; offset?: number }): Conversation[];
  createConversation(input: CreateConversationInput): Conversation;

  // 消息
  findMessageById(id: number): Message | undefined;
  listMessages(conversationId: string, limit?: number, offset?: number): Message[];
  createMessage(input: CreateMessageInput): Message;

  // 消息事件
  listMessageEvents(messageId: number): MessageEvent[];
  appendEvent(messageId: number, event: Omit<MessageEvent, "id" | "created_at">): MessageEvent;

  // 消息上下文
  getMessageContext(messageId: number): MessageContext | null;
  setMessageContext(messageId: number, kind: MessageContextKind, context: string): void;

  // 消息分发
  listPendingDispatches(conversationId: string): MessageDispatch[];
  createDispatch(conversationId: string, messageId: number, toRole: string): MessageDispatch;
  updateDispatchStatus(dispatchId: number, status: MessageDispatchStatus, consumedByMessageId?: number): void;

  // IM 渠道配置
  listChannelConfigs(): IMChannelConfig[];
  getChannelConfig(type: string): IMChannelConfig | undefined;
}

/** IM 内存存储实现 */
export class InMemoryIMRepository implements IMRepository {
  private conversations = new Map<string, Conversation>();
  private messages = new Map<number, Message>();
  private events = new Map<number, MessageEvent[]>();
  private contexts = new Map<number, MessageContext>();
  private dispatches = new Map<number, MessageDispatch>();
  private channelConfigs = new Map<string, IMChannelConfig>();

  private nextMessageId = 1;
  private nextEventId = 1;
  private nextDispatchId = 1;

  // ── 会话 ──────────────────────────────────────────────────────────────

  findConversationById(id: string): Conversation | undefined {
    return this.conversations.get(id);
  }

  listConversations(filters?: { workspace_id?: string; issue_id?: string; stage_id?: string; limit?: number; offset?: number }): Conversation[] {
    let result = [...this.conversations.values()];

    if (filters?.workspace_id) {
      result = result.filter(c => c.workspace_id === filters.workspace_id);
    }
    if (filters?.issue_id) {
      result = result.filter(c => c.issue_id === filters.issue_id);
    }
    if (filters?.stage_id) {
      result = result.filter(c => c.stage_id === filters.stage_id);
    }

    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? 50;
    return result.slice(offset, offset + limit);
  }

  createConversation(input: CreateConversationInput): Conversation {
    if (this.conversations.has(input.id)) {
      throw new Error(`Conversation already exists: ${input.id}`);
    }

    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: input.id,
      workspace_id: input.workspace_id,
      issue_id: input.issue_id,
      stage_id: input.stage_id,
      owner_type: input.owner_type ?? "workspace_stage",
      owner_id: input.owner_id ?? null,
      title: input.title,
      kind: input.kind,
      status: "active",
      default_role: input.default_role,
      participating_roles: input.participating_roles,
      summary: input.summary ?? null,
      from_conversation_ids: input.from_conversation_ids ?? [],
      created_at: now,
      updated_at: now,
    };

    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  // ── 消息 ──────────────────────────────────────────────────────────────

  findMessageById(id: number): Message | undefined {
    return this.messages.get(id);
  }

  listMessages(conversationId: string, limit = 50, offset = 0): Message[] {
    const result = [...this.messages.values()]
      .filter(m => m.conversation_id === conversationId)
      .sort((a, b) => a.id - b.id);
    return result.slice(offset, offset + limit);
  }

  createMessage(input: CreateMessageInput): Message {
    const id = this.nextMessageId++;
    const now = new Date().toISOString();

    const message: Message = {
      id,
      conversation_id: input.conversation_id,
      client_id: input.client_id ?? null,
      from_role: input.from_role,
      to_roles: input.to_roles,
      role: input.role,
      quoted_message_id: input.quoted_message_id ?? null,
      context_cutoff_at: input.context_cutoff_at ?? "0",
      runtime: input.runtime ?? null,
      status: input.status ?? "completed",
      created_at: now,
      updated_at: now,
    };

    this.messages.set(id, message);
    this.events.set(id, []);
    return message;
  }

  // ── 消息事件 ──────────────────────────────────────────────────────────

  listMessageEvents(messageId: number): MessageEvent[] {
    return this.events.get(messageId) ?? [];
  }

  appendEvent(messageId: number, event: Omit<MessageEvent, "id" | "created_at">): MessageEvent {
    const messageEvents = this.events.get(messageId);
    if (!messageEvents) {
      throw new Error(`Message not found: ${messageId}`);
    }

    const newEvent: MessageEvent = {
      ...event,
      id: this.nextEventId++,
      created_at: new Date().toISOString(),
    };

    messageEvents.push(newEvent);
    return newEvent;
  }

  // ── 消息上下文 ────────────────────────────────────────────────────────

  getMessageContext(messageId: number): MessageContext | null {
    return this.contexts.get(messageId) ?? null;
  }

  setMessageContext(messageId: number, kind: MessageContextKind, context: string): void {
    this.contexts.set(messageId, {
      message_id: messageId,
      kind,
      context,
      updated_at: new Date().toISOString(),
    });
  }

  // ── 消息分发 ──────────────────────────────────────────────────────────

  listPendingDispatches(conversationId: string): MessageDispatch[] {
    return [...this.dispatches.values()]
      .filter(d => d.conversation_id === conversationId && d.status === "pending");
  }

  createDispatch(conversationId: string, messageId: number, toRole: string): MessageDispatch {
    const id = this.nextDispatchId++;
    const now = new Date().toISOString();

    const dispatch: MessageDispatch = {
      id,
      conversation_id: conversationId,
      message_id: messageId,
      to_role: toRole,
      status: "pending",
      consumed_by_message_id: null,
      created_at: now,
      consumed_at: null,
    };

    this.dispatches.set(id, dispatch);
    return dispatch;
  }

  updateDispatchStatus(dispatchId: number, status: MessageDispatchStatus, consumedByMessageId?: number): void {
    const dispatch = this.dispatches.get(dispatchId);
    if (!dispatch) {
      throw new Error(`Dispatch not found: ${dispatchId}`);
    }

    dispatch.status = status;
    if (consumedByMessageId) {
      dispatch.consumed_by_message_id = consumedByMessageId;
    }
    if (status === "consumed" || status === "skipped") {
      dispatch.consumed_at = new Date().toISOString();
    }
  }

  // ── IM 渠道配置 ──────────────────────────────────────────────────────

  listChannelConfigs(): IMChannelConfig[] {
    return [...this.channelConfigs.values()];
  }

  getChannelConfig(type: string): IMChannelConfig | undefined {
    return this.channelConfigs.get(type);
  }

  /** 注册渠道配置（内部方法） */
  registerChannelConfig(config: IMChannelConfig): void {
    this.channelConfigs.set(config.type, config);
  }
}
