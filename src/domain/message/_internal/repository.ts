import type { SQLiteDatabase } from "@infra/database";
import type {
  Message,
  MessageEvent,
  MessageEventPayload,
  MessageContext,
  MessageContextKind,
} from "@domain/message/model";

const MESSAGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id TEXT NOT NULL,
  from_speaker TEXT,
  to_speakers TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_message_stage_id ON message(stage_id, id ASC);

CREATE TABLE IF NOT EXISTS message_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES message(id),
  seq INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(message_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_message_event_message_id ON message_event(message_id, seq ASC);

CREATE TABLE IF NOT EXISTS message_context (
  message_id INTEGER PRIMARY KEY REFERENCES message(id),
  kind TEXT NOT NULL,
  context TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS read_cursor (
  stage_id TEXT NOT NULL,
  speaker TEXT NOT NULL,
  last_read_message_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(stage_id, speaker)
);
`;

type MessageRow = {
  id: number;
  stage_id: string;
  from_speaker: string | null;
  to_speakers: string;
  status: Message["status"];
  created_at: string;
  ended_at: string | null;
};

type MessageEventRow = {
  id: number;
  message_id: number;
  seq: number;
  payload: string;
  created_at: string;
};

type MessageContextRow = MessageContext;

// ── Message Repository ────────────────────────────────────────────────

export interface MessageRepository {
  findById(id: number): Message | undefined;
  /** 查询 stage 中消息，默认按 id DESC 返回最新消息；beforeId 用于 cursor-based 翻页加载更早消息 */
  listByStage(stageId: string, limit?: number, beforeId?: number): Message[];
  listByStatus(status: Message["status"], limit?: number): Message[];
  /** 查询 stageId 中 id > afterId 的所有消息（按 id ASC），用于 cursor-based 读取 */
  listByStageAfterId(stageId: string, afterId: number): Message[];
  /** 窗口查询：返回锚点消息前后各 N 条（按 id ASC） */
  listByStageWindow(stageId: string, anchorId: number, before: number, after: number): Message[];
  /** 跨 stage 关键词搜索 message_context（SQL LIKE），返回匹配的 {message, context} */
  searchContext(stageId: string, query: string, limit: number): Array<{ message: Message; context: MessageContext }>;
  /** 查询 stageId 中最近一条非 user/system 的已完成消息的 from_speaker */
  findLatestRespondingSpeaker(stageId: string): string | null;
  /** 查询 stageId 中最新一条消息（按 id DESC LIMIT 1） */
  findLatestMessage(stageId: string): Message | undefined;
  /** 查询 stageId 中指定 from_speaker 的最新一条消息（按 id DESC LIMIT 1） */
  findLatestMessageBySpeaker(stageId: string, fromSpeaker: string): Message | undefined;
  create(message: Message): Message;
  update(id: number, updates: Partial<Message>): void;
  transaction<T>(fn: () => T): T;
}

export class SQLiteMessageRepository implements MessageRepository {
  constructor(private db: SQLiteDatabase) {
    db.initSchema(MESSAGE_SCHEMA);
  }

  findById(id: number): Message | undefined {
    const row = this.db.get<MessageRow>(`SELECT * FROM message WHERE id = ?`, [id]);
    return row ? mapMessage(row) : undefined;
  }

  /** 默认返回最新 limit 条（DESC）；传入 beforeId 时返回 id < beforeId 的更早消息 */
  listByStage(stageId: string, limit = 50, beforeId?: number): Message[] {
    if (beforeId !== undefined) {
      return this.db.all<MessageRow>(
        `SELECT * FROM message WHERE stage_id = ? AND id < ? ORDER BY id DESC LIMIT ?`,
        [stageId, beforeId, limit],
      ).map(mapMessage);
    }
    return this.db.all<MessageRow>(
      `SELECT * FROM message WHERE stage_id = ? ORDER BY id DESC LIMIT ?`,
      [stageId, limit],
    ).map(mapMessage);
  }

  listByStatus(status: Message["status"], limit = 500): Message[] {
    return this.db.all<MessageRow>(
      `SELECT * FROM message WHERE status = ? ORDER BY id ASC LIMIT ?`,
      [status, limit],
    ).map(mapMessage);
  }

  listByStageAfterId(stageId: string, afterId: number): Message[] {
    return this.db.all<MessageRow>(
      `SELECT * FROM message WHERE stage_id = ? AND id > ? ORDER BY id ASC`,
      [stageId, afterId],
    ).map(mapMessage);
  }

  listByStageWindow(stageId: string, anchorId: number, before: number, after: number): Message[] {
    // 锚点之前的 before 条 + 锚点本身 + 锚点之后的 after 条
    return this.db.all<MessageRow>(
      `SELECT * FROM message WHERE stage_id = ? AND id IN (
         SELECT id FROM message WHERE stage_id = ? AND id <= ? ORDER BY id DESC LIMIT ?
         UNION
         SELECT id FROM message WHERE stage_id = ? AND id > ? ORDER BY id ASC LIMIT ?
       ) ORDER BY id ASC`,
      [stageId, stageId, anchorId, before + 1, stageId, anchorId, after],
    ).map(mapMessage);
  }

  searchContext(stageId: string, query: string, limit: number): Array<{ message: Message; context: MessageContext }> {
    type SearchRow = MessageRow & { ctx_message_id: number; ctx_kind: string; ctx_context: string; ctx_created_at: string };
    // 转义 SQL LIKE 通配符：% → \%, _ → \_, \ → \\
    const escaped = query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    const rows = this.db.all<SearchRow>(
      `SELECT m.*, mc.message_id AS ctx_message_id, mc.kind AS ctx_kind, mc.context AS ctx_context, mc.created_at AS ctx_created_at
       FROM message m
       INNER JOIN message_context mc ON mc.message_id = m.id
       WHERE m.stage_id = ? AND mc.context LIKE '%' || ? || '%' ESCAPE '\\'
       ORDER BY m.id DESC
       LIMIT ?`,
      [stageId, escaped, limit],
    );
    return rows.map((row) => ({
      message: mapMessage(row),
      context: { message_id: row.ctx_message_id, kind: row.ctx_kind as MessageContextKind, context: row.ctx_context, created_at: row.ctx_created_at },
    }));
  }

  findLatestRespondingSpeaker(stageId: string): string | null {
    const row = this.db.get<{ from_speaker: string }>(
      `SELECT from_speaker FROM message
       WHERE stage_id = ? AND from_speaker IS NOT NULL
         AND from_speaker NOT IN ('user', 'system') AND status = 'completed'
       ORDER BY id DESC LIMIT 1`,
      [stageId],
    );
    return row?.from_speaker ?? null;
  }

  findLatestMessage(stageId: string): Message | undefined {
    const row = this.db.get<MessageRow>(
      `SELECT * FROM message WHERE stage_id = ? ORDER BY id DESC LIMIT 1`,
      [stageId],
    );
    return row ? mapMessage(row) : undefined;
  }

  findLatestMessageBySpeaker(stageId: string, fromSpeaker: string): Message | undefined {
    const row = this.db.get<MessageRow>(
      `SELECT * FROM message WHERE stage_id = ? AND from_speaker = ? ORDER BY id DESC LIMIT 1`,
      [stageId, fromSpeaker],
    );
    return row ? mapMessage(row) : undefined;
  }

  create(message: Message): Message {
    const id = this.db.run(
      `INSERT INTO message (stage_id, from_speaker, to_speakers, status, created_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        message.stage_id,
        message.from_speaker,
        JSON.stringify(message.to_speakers),
        message.status,
        message.created_at,
        message.ended_at,
      ],
    );
    return { ...message, id };
  }

  update(id: number, updates: Partial<Message>): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (updates.stage_id !== undefined) {
      sets.push("stage_id = ?");
      params.push(updates.stage_id);
    }
    if (updates.from_speaker !== undefined) {
      sets.push("from_speaker = ?");
      params.push(updates.from_speaker);
    }
    if (updates.to_speakers !== undefined) {
      sets.push("to_speakers = ?");
      params.push(JSON.stringify(updates.to_speakers));
    }
    if (updates.status !== undefined) {
      sets.push("status = ?");
      params.push(updates.status);
    }
    if (updates.created_at !== undefined) {
      sets.push("created_at = ?");
      params.push(updates.created_at);
    }
    if (updates.ended_at !== undefined) {
      sets.push("ended_at = ?");
      params.push(updates.ended_at);
    }
    if (sets.length === 0) return;
    params.push(id);
    this.db.run(`UPDATE message SET ${sets.join(", ")} WHERE id = ?`, params);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }
}

// ── Event Repository ──────────────────────────────────────────────────

export interface EventRepository {
  listByMessage(messageId: number): MessageEvent[];
  append(messageId: number, payload: MessageEventPayload): MessageEvent;
}

export class SQLiteEventRepository implements EventRepository {
  constructor(private db: SQLiteDatabase) {
    db.initSchema(MESSAGE_SCHEMA);
  }

  listByMessage(messageId: number): MessageEvent[] {
    return this.db.all<MessageEventRow>(
      `SELECT * FROM message_event WHERE message_id = ? ORDER BY seq ASC`,
      [messageId],
    ).map(mapMessageEvent);
  }

  append(messageId: number, payload: MessageEventPayload): MessageEvent {
    const createdAt = new Date().toISOString();
    const id = this.db.run(
      `INSERT INTO message_event (message_id, seq, payload, created_at)
       SELECT ?, COALESCE(MAX(seq), -1) + 1, ?, ?
       FROM message_event
       WHERE message_id = ?`,
      [messageId, JSON.stringify(payload), createdAt, messageId],
    );
    const row = this.db.get<MessageEventRow>(`SELECT * FROM message_event WHERE id = ?`, [id]);
    if (!row) throw new Error(`Message event not found after insert: ${id}`);
    return mapMessageEvent(row);
  }
}

// ── Context Repository ────────────────────────────────────────────────

export interface ContextRepository {
  get(messageId: number): MessageContext | null;
  set(messageId: number, kind: MessageContextKind, context: string): void;
}

export class SQLiteContextRepository implements ContextRepository {
  constructor(private db: SQLiteDatabase) {
    db.initSchema(MESSAGE_SCHEMA);
  }

  get(messageId: number): MessageContext | null {
    return this.db.get<MessageContextRow>(`SELECT * FROM message_context WHERE message_id = ?`, [messageId]) ?? null;
  }

  set(messageId: number, kind: MessageContextKind, context: string): void {
    this.db.run(
      `INSERT INTO message_context (message_id, kind, context, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET kind = excluded.kind, context = excluded.context, created_at = excluded.created_at`,
      [messageId, kind, context, new Date().toISOString()],
    );
  }
}

// ── ReadCursor Repository ─────────────────────────────────────────────

export interface ReadCursorRepository {
  get(stageId: string, speaker: string): number;
  set(stageId: string, speaker: string, messageId: number): void;
}

export class SQLiteReadCursorRepository implements ReadCursorRepository {
  constructor(private db: SQLiteDatabase) {
    db.initSchema(MESSAGE_SCHEMA);
  }

  get(stageId: string, speaker: string): number {
    return this.db.get<{ last_read_message_id: number }>(
      `SELECT last_read_message_id FROM read_cursor WHERE stage_id = ? AND speaker = ?`,
      [stageId, speaker],
    )?.last_read_message_id ?? 0;
  }

  set(stageId: string, speaker: string, messageId: number): void {
    this.db.run(
      `INSERT INTO read_cursor (stage_id, speaker, last_read_message_id, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(stage_id, speaker) DO UPDATE SET last_read_message_id = excluded.last_read_message_id, updated_at = excluded.updated_at`,
      [stageId, speaker, messageId, new Date().toISOString()],
    );
  }
}

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    stage_id: row.stage_id,
    from_speaker: row.from_speaker,
    to_speakers: JSON.parse(row.to_speakers),
    status: row.status,
    created_at: row.created_at,
    ended_at: row.ended_at,
  };
}

function mapMessageEvent(row: MessageEventRow): MessageEvent {
  return {
    id: row.id,
    message_id: row.message_id,
    seq: row.seq,
    payload: JSON.parse(row.payload),
    created_at: row.created_at,
  };
}
