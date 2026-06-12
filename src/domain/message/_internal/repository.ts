import type {
  Message,
  MessageEvent,
  MessageEventPayload,
  MessageContext,
  MessageContextKind,
  CallSignal,
} from "@domain/message/model";

// ── Message Repository ────────────────────────────────────────────────

export interface MessageRepository {
  findById(id: number): Message | undefined;
  listByStage(stageId: string, limit?: number, offset?: number): Message[];
  create(message: Message): void;
  update(id: number, updates: Partial<Message>): void;
}

export class InMemoryMessageRepository implements MessageRepository {
  private messages = new Map<number, Message>();
  private nextId = 1;

  findById(id: number): Message | undefined {
    return this.messages.get(id);
  }

  listByStage(stageId: string, limit = 50, offset = 0): Message[] {
    return [...this.messages.values()]
      .filter(m => m.stage_id === stageId)
      .sort((a, b) => a.id - b.id)
      .slice(offset, offset + limit);
  }

  create(message: Message): void {
    const id = this.nextId++;
    this.messages.set(id, { ...message, id });
  }

  update(id: number, updates: Partial<Message>): void {
    const msg = this.messages.get(id);
    if (!msg) throw new Error(`Message not found: ${id}`);
    Object.assign(msg, updates);
  }
}

// ── Event Repository ──────────────────────────────────────────────────

export interface EventRepository {
  listByMessage(messageId: number): MessageEvent[];
  append(messageId: number, payload: MessageEventPayload): MessageEvent;
}

export class InMemoryEventRepository implements EventRepository {
  private events = new Map<number, MessageEvent[]>();
  private nextId = 1;

  listByMessage(messageId: number): MessageEvent[] {
    return this.events.get(messageId) ?? [];
  }

  append(messageId: number, payload: MessageEventPayload): MessageEvent {
    const existing = this.events.get(messageId) ?? [];
    const newEvent: MessageEvent = {
      id: this.nextId++,
      message_id: messageId,
      seq: existing.length,
      payload,
      created_at: new Date().toISOString(),
    };
    existing.push(newEvent);
    this.events.set(messageId, existing);
    return newEvent;
  }
}

// ── Context Repository ────────────────────────────────────────────────

export interface ContextRepository {
  get(messageId: number): MessageContext | null;
  set(messageId: number, kind: MessageContextKind, context: string): void;
}

export class InMemoryContextRepository implements ContextRepository {
  private contexts = new Map<number, MessageContext>();

  get(messageId: number): MessageContext | null {
    return this.contexts.get(messageId) ?? null;
  }

  set(messageId: number, kind: MessageContextKind, context: string): void {
    this.contexts.set(messageId, {
      message_id: messageId,
      kind,
      context,
      created_at: new Date().toISOString(),
    });
  }
}

// ── ReadCursor Repository ─────────────────────────────────────────────

export interface ReadCursorRepository {
  get(stageId: string, speaker: string): number;
  set(stageId: string, speaker: string, messageId: number): void;
}

export class InMemoryReadCursorRepository implements ReadCursorRepository {
  private cursors = new Map<string, number>();

  private key(stageId: string, speaker: string): string {
    return `${stageId}:${speaker}`;
  }

  get(stageId: string, speaker: string): number {
    return this.cursors.get(this.key(stageId, speaker)) ?? 0;
  }

  set(stageId: string, speaker: string, messageId: number): void {
    this.cursors.set(this.key(stageId, speaker), messageId);
  }
}

// ── CallSignal Repository ─────────────────────────────────────────────

export interface CallSignalRepository {
  create(stageId: string, targetSpeaker: string): void;
  listByStage(stageId: string): CallSignal[];
  listAll(): CallSignal[];
  delete(stageId: string, targetSpeaker: string): void;
}

export class InMemoryCallSignalRepository implements CallSignalRepository {
  private signals = new Map<string, CallSignal>();

  private key(stageId: string, speaker: string): string {
    return `${stageId}:${speaker}`;
  }

  create(stageId: string, targetSpeaker: string): void {
    const k = this.key(stageId, targetSpeaker);
    if (!this.signals.has(k)) {
      this.signals.set(k, {
        stage_id: stageId,
        target_speaker: targetSpeaker,
        created_at: new Date().toISOString(),
      });
    }
  }

  listByStage(stageId: string): CallSignal[] {
    return [...this.signals.values()].filter(s => s.stage_id === stageId);
  }

  listAll(): CallSignal[] {
    return [...this.signals.values()];
  }

  delete(stageId: string, targetSpeaker: string): void {
    this.signals.delete(this.key(stageId, targetSpeaker));
  }
}
