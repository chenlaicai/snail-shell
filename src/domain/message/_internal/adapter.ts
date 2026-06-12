import type {
  Message,
  MessageStatus,
  CreateMessageInput,
  MessageEvent,
  MessageEventPayload,
  MessageContext,
  MessageContextKind,
  CallSignal,
} from "@domain/message/model";
import type { MessagePort } from "@domain/message/port";
import type {
  MessageRepository,
  EventRepository,
  ContextRepository,
  ReadCursorRepository,
  CallSignalRepository,
} from "./repository";

export class MessageAdapter implements MessagePort {
  constructor(
    private messageRepo: MessageRepository,
    private eventRepo: EventRepository,
    private contextRepo: ContextRepository,
    private cursorRepo: ReadCursorRepository,
    private callSignalRepo: CallSignalRepository,
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
    this.messageRepo.create(message);
    return message;
  }

  getMessage(id: number): Message | undefined {
    return this.messageRepo.findById(id);
  }

  listMessages(stageId: string, limit?: number, offset?: number): Message[] {
    return this.messageRepo.listByStage(stageId, limit, offset);
  }

  completeMessage(messageId: number, status: MessageStatus, signalPayload?: Record<string, unknown>): void {
    const message = this.messageRepo.findById(messageId);
    if (!message) throw new Error(`Message not found: ${messageId}`);

    const payload = {
      type: "signal" as const,
      signal: status === "completed" ? "message_completed" : `message_${status}`,
      ...signalPayload,
    };
    this.eventRepo.append(messageId, { payload });
    this.messageRepo.update(messageId, { status, ended_at: new Date().toISOString() });
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
    this.contextRepo.set(messageId, kind, context);
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
    const all = this.messageRepo.listByStage(stageId);
    return all.filter(m => m.id > cursor);
  }

  initCursor(stageId: string, speaker: string): void {
    this.cursorRepo.set(stageId, speaker, 0);
  }

  // ── CallSignal ───────────────────────────────────────────────────────

  createCallSignal(stageId: string, targetSpeaker: string): void {
    this.callSignalRepo.create(stageId, targetSpeaker);
  }

  getCallSignals(stageId: string): CallSignal[] {
    return this.callSignalRepo.listByStage(stageId);
  }

  getAllCallSignals(): Map<string, CallSignal[]> {
    const all = this.callSignalRepo.listAll();
    const groups = new Map<string, CallSignal[]>();
    for (const s of all) {
      const list = groups.get(s.stage_id) ?? [];
      list.push(s);
      groups.set(s.stage_id, list);
    }
    return groups;
  }

  deleteCallSignal(stageId: string, targetSpeaker: string): void {
    this.callSignalRepo.delete(stageId, targetSpeaker);
  }
}
