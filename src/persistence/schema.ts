export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS project (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    summary TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stage (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    type TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    status TEXT NOT NULL,
    formal_artifacts TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    entered_at TEXT,
    left_at TEXT,
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
    UNIQUE(project_id, sequence)
  );

  CREATE TABLE IF NOT EXISTS conversation (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    default_snail TEXT NOT NULL,
    participating_snails TEXT NOT NULL DEFAULT '[]',
    summary TEXT,
    from_conversation_ids TEXT NOT NULL DEFAULT '[]',
    runtime_sessions TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
    FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    producer_snail TEXT,
    role TEXT NOT NULL,
    reply_to_message_id INTEGER,
    quoted_message_id INTEGER,
    context_cutoff_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversation(id) ON DELETE CASCADE,
    FOREIGN KEY (reply_to_message_id) REFERENCES message(id) ON DELETE SET NULL,
    FOREIGN KEY (quoted_message_id) REFERENCES message(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS message_part (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    part_type TEXT NOT NULL,
    text_value TEXT,
    mentions TEXT,
    json_value TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (message_id) REFERENCES message(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS message_dispatch (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    target_snail TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    consumed_by_message_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    consumed_at TEXT,
    FOREIGN KEY (conversation_id) REFERENCES conversation(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES message(id) ON DELETE CASCADE,
    FOREIGN KEY (consumed_by_message_id) REFERENCES message(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS artifact (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    artifact_type TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    storage_type TEXT NOT NULL,
    file_path TEXT,
    inline_content TEXT,
    external_ref TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
    FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversation(id) ON DELETE CASCADE
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(
    conversation_id UNINDEXED,
    message_id UNINDEXED,
    role UNINDEXED,
    producer_snail UNINDEXED,
    content
  );

  CREATE INDEX IF NOT EXISTS idx_stage_project_sequence ON stage(project_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_conversation_project_stage ON conversation(project_id, stage_id);
  CREATE INDEX IF NOT EXISTS idx_message_conversation_created_at ON message(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_message_part_message_created_at ON message_part(message_id, created_at, id);
  CREATE INDEX IF NOT EXISTS idx_message_dispatch_target_status ON message_dispatch(conversation_id, target_snail, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_artifact_project_stage ON artifact(project_id, stage_id);
  CREATE INDEX IF NOT EXISTS idx_artifact_conversation ON artifact(conversation_id);
`;
