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

  CREATE TABLE IF NOT EXISTS feature (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    status TEXT NOT NULL,
    branch_name TEXT,
    worktree_path TEXT,
    pr_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT,
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS stage (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    feature_id TEXT NOT NULL,
    type TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    status TEXT NOT NULL,
    formal_artifacts TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    entered_at TEXT,
    left_at TEXT,
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
    FOREIGN KEY (feature_id) REFERENCES feature(id) ON DELETE CASCADE,
    UNIQUE(feature_id, sequence)
  );

  CREATE TABLE IF NOT EXISTS conversation (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    feature_id TEXT NOT NULL,
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
    FOREIGN KEY (feature_id) REFERENCES feature(id) ON DELETE CASCADE,
    FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    client_id TEXT,
    from_snail TEXT,
    to_snails TEXT NOT NULL DEFAULT '[]',
    role TEXT NOT NULL,
    quoted_message_id INTEGER,
    context_cutoff_at TEXT NOT NULL DEFAULT (datetime('now')),
    runtime TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversation(id) ON DELETE CASCADE,
    FOREIGN KEY (quoted_message_id) REFERENCES message(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS message_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    category TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (message_id) REFERENCES message(id) ON DELETE CASCADE,
    UNIQUE(message_id, seq)
  );

  CREATE TABLE IF NOT EXISTS message_context (
    message_id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    context TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (message_id) REFERENCES message(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS message_dispatch (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    to_snail TEXT NOT NULL,
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
    feature_id TEXT NOT NULL,
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
    FOREIGN KEY (feature_id) REFERENCES feature(id) ON DELETE CASCADE,
    FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversation(id) ON DELETE CASCADE
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(
    conversation_id UNINDEXED,
    message_id UNINDEXED,
    role UNINDEXED,
    from_snail UNINDEXED,
    content
  );

  CREATE INDEX IF NOT EXISTS idx_feature_project_status ON feature(project_id, status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_stage_feature_sequence ON stage(feature_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_conversation_project_stage ON conversation(project_id, stage_id);
  CREATE INDEX IF NOT EXISTS idx_conversation_feature_stage ON conversation(feature_id, stage_id);
  CREATE INDEX IF NOT EXISTS idx_message_conversation_created_at ON message(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_message_event_message_seq ON message_event(message_id, seq);
  CREATE INDEX IF NOT EXISTS idx_message_event_id ON message_event(id);
  CREATE INDEX IF NOT EXISTS idx_message_dispatch_to_status ON message_dispatch(conversation_id, to_snail, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_artifact_project_stage ON artifact(project_id, stage_id);
  CREATE INDEX IF NOT EXISTS idx_artifact_feature_stage ON artifact(feature_id, stage_id);
  CREATE INDEX IF NOT EXISTS idx_artifact_conversation ON artifact(conversation_id);
`;
