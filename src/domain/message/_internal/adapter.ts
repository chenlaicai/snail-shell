import type {
  Message,
  MessageStatus,
  CreateMessageInput,
  MessageEvent,
  MessageEventPayload,
  MessageContext,
  MessageContextKind,
} from "@domain/message/model";
import type { MessagePort } from "@domain/message/port";
import type {
  MessageRepository,
  EventRepository,
  ContextRepository,
  ReadCursorRepository,
} from "@domain/message/_internal/repository";
import type { MessageSearchIndex } from "@domain/message/_internal/search-index";

export class MessageAdapter implements MessagePort {
  constructor(
    private messageRepo: MessageRepository,
    private eventRepo: EventRepository,
    private contextRepo: ContextRepository,
    private cursorRepo: ReadCursorRepository,
    private searchIndex: MessageSearchIndex,
  ) {}

  // ── Message CRUD ─────────────────────────────────────────────────────

  createMessage(input: CreateMessageInput): Message {
    const now = new Date().toISOString();
    const status = input.status ?? "completed";
    const message: Message = {
      id: 0,
      stage_id: input.stage_id,
      from_speaker: input.from_speaker,
      to_speakers: input.to_speakers,
      status,
      created_at: now,
      ended_at: status !== "streaming" ? now : null,
    };
    return this.messageRepo.create(message);
  }

  getMessage(id: number): Message | undefined {
    return this.messageRepo.findById(id);
  }

  listMessages(stageId: string, limit?: number, beforeId?: number): Message[] {
    return this.messageRepo.listByStage(stageId, limit, beforeId);
  }

  listMessagesWindow(stageId: string, anchorId: number, before: number, after: number): Message[] {
    return this.messageRepo.listByStageWindow(stageId, anchorId, before, after);
  }

  searchContext(stageId: string, query: string, limit: number): Array<{ message: Message; context: MessageContext }> {
    return this.messageRepo.searchContext(stageId, query, limit);
  }

  searchByFts(stageIds: string[], query: string, limit: number): Array<{ message_id: number; stage_id: string; from_speaker: string | null; content: string; created_at: string }> {
    const results = this.searchIndex.searchByStageIds(query, new Set(stageIds), limit);
    return results.map((r) => ({
      message_id: r.message_id,
      stage_id: r.stage_id,
      from_speaker: r.from_speaker,
      content: this.contextRepo.get(r.message_id)?.context ?? "",
      created_at: r.created_at,
    }));
  }

  listMessagesByStatus(status: MessageStatus, limit?: number): Message[] {
    return this.messageRepo.listByStatus(status, limit);
  }

  updateMessageTargets(messageId: number, toSpeakers: string[]): void {
    this.messageRepo.update(messageId, { to_speakers: toSpeakers });
  }

  completeMessage(messageId: number, status: MessageStatus, signalPayload?: Record<string, unknown>): void {
    this.messageRepo.transaction(() => {
      const message = this.messageRepo.findById(messageId);
      if (!message) throw new Error(`Message not found: ${messageId}`);

      const payload = {
        type: "signal" as const,
        signal: status === "completed" ? "message_completed" : `message_${status}`,
        ...signalPayload,
      };
      this.eventRepo.append(messageId, payload);
      this.messageRepo.update(messageId, { status, ended_at: new Date().toISOString() });
    });
  }

  // ── Event ────────────────────────────────────────────────────────────

  appendEvent(messageId: number, payload: MessageEventPayload): MessageEvent {
    return this.eventRepo.append(messageId, payload);
  }

  getMessageEvents(messageId: number): MessageEvent[] {
    return this.eventRepo.listByMessage(messageId);
  }

  // ── Context ──────────────────────────────────────────────────────────

  getContext(messageId: number): MessageContext | null {
    return this.contextRepo.get(messageId);
  }

  setContext(messageId: number, kind: MessageContextKind, context: string): void {
    this.messageRepo.transaction(() => {
      this.contextRepo.set(messageId, kind, context);
      const message = this.messageRepo.findById(messageId);
      if (message) {
        this.searchIndex.indexMessage(messageId, message.stage_id, context);
      }
    });
  }

  // ── ReadCursor ───────────────────────────────────────────────────────

  getCursor(stageId: string, speaker: string): number {
    return this.cursorRepo.get(stageId, speaker);
  }

  advanceCursor(stageId: string, speaker: string, messageId: number): void {
    this.cursorRepo.set(stageId, speaker, messageId);
  }

  getUnreadMessages(stageId: string, speaker: string): Message[] {
    const cursor = this.cursorRepo.get(stageId, speaker);
    return this.messageRepo.listByStageAfterId(stageId, cursor);
  }

  initCursor(stageId: string, speaker: string): void {
    this.cursorRepo.set(stageId, speaker, 0);
  }

  findLatestRespondingSpeaker(stageId: string): string | null {
    return this.messageRepo.findLatestRespondingSpeaker(stageId);
  }

  findLatestMessage(stageId: string): Message | undefined {
    return this.messageRepo.findLatestMessage(stageId);
  }

  findLatestMessageBySpeaker(stageId: string, fromSpeaker: string): Message | undefined {
    return this.messageRepo.findLatestMessageBySpeaker(stageId, fromSpeaker);
  }

  findLatestMessageByIssueId(issueId: string): Message | undefined {
    return this.messageRepo.findLatestMessageByIssueId(issueId);
  }
}
