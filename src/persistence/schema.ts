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

  CREATE TABLE IF NOT EXISTS project_stage_definition (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    input_description TEXT,
    output_description TEXT,
    acceptance_focus TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
    UNIQUE(project_id, key),
    UNIQUE(project_id, sequence)
  );

  CREATE TABLE IF NOT EXISTS stage_role_definition (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    stage_definition_id TEXT NOT NULL,
    snail_id TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0,
    working_rules TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
    FOREIGN KEY (stage_definition_id) REFERENCES project_stage_definition(id) ON DELETE CASCADE,
    UNIQUE(stage_definition_id, snail_id)
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
    stage_definition_id TEXT NOT NULL,
    type TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    status TEXT NOT NULL,
    input_artifacts TEXT NOT NULL DEFAULT '[]',
    output_artifacts TEXT NOT NULL DEFAULT '[]',
    entered_at TEXT,
    left_at TEXT,
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
    FOREIGN KEY (feature_id) REFERENCES feature(id) ON DELETE CASCADE,
    FOREIGN KEY (stage_definition_id) REFERENCES project_stage_definition(id),
    UNIQUE(feature_id, sequence)
  );

  CREATE TABLE IF NOT EXISTS conversation (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    feature_id TEXT,
    stage_id TEXT,
    owner_type TEXT NOT NULL DEFAULT 'project_stage',
    owner_id TEXT,
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
    context_cutoff_at TEXT NOT NULL DEFAULT '0',
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

  CREATE TABLE IF NOT EXISTS knowledge_item (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    scope_type TEXT NOT NULL,
    scope_ref TEXT,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    governance_level TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    rationale TEXT,
    created_by TEXT,
    approved_by TEXT,
    approved_at TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS knowledge_source (
    id TEXT PRIMARY KEY,
    knowledge_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    quote TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (knowledge_id) REFERENCES knowledge_item(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS knowledge_candidate_review (
    id TEXT PRIMARY KEY,
    knowledge_id TEXT NOT NULL,
    reviewer TEXT NOT NULL,
    decision TEXT NOT NULL,
    comment TEXT,
    before_snapshot TEXT,
    after_snapshot TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (knowledge_id) REFERENCES knowledge_item(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS knowledge_governance (
    id TEXT PRIMARY KEY,
    knowledge_id TEXT NOT NULL UNIQUE,
    entry_check_status TEXT NOT NULL DEFAULT 'pending_entry_check',
    dedupe_status TEXT NOT NULL DEFAULT 'pending',
    scenario_type TEXT NOT NULL DEFAULT 'pending',
    disposition_status TEXT NOT NULL DEFAULT 'pending',
    artifact_type TEXT NOT NULL DEFAULT 'pending',
    related_knowledge_ids TEXT NOT NULL DEFAULT '[]',
    final_destination TEXT,
    governance_pr_url TEXT,
    disposition_reason TEXT,
    deferred_reason TEXT,
    retrigger_condition TEXT,
    runtime_feedback_allowed INTEGER NOT NULL DEFAULT 0,
    runtime_feedback_channels TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT,
    FOREIGN KEY (knowledge_id) REFERENCES knowledge_item(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS knowledge_governance_conversation (
    id TEXT PRIMARY KEY,
    governance_id TEXT NOT NULL UNIQUE,
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
    FOREIGN KEY (governance_id) REFERENCES knowledge_governance(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS knowledge_governance_message (
    id INTEGER PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    client_id TEXT,
    from_snail TEXT,
    to_snails TEXT NOT NULL DEFAULT '[]',
    role TEXT NOT NULL,
    quoted_message_id INTEGER,
    context_cutoff_at TEXT NOT NULL DEFAULT '0',
    runtime TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES knowledge_governance_conversation(id) ON DELETE CASCADE,
    FOREIGN KEY (quoted_message_id) REFERENCES knowledge_governance_message(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS knowledge_governance_message_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    category TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (message_id) REFERENCES knowledge_governance_message(id) ON DELETE CASCADE,
    UNIQUE(message_id, seq)
  );

  CREATE TABLE IF NOT EXISTS knowledge_governance_message_context (
    message_id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    context TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (message_id) REFERENCES knowledge_governance_message(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS knowledge_governance_message_dispatch (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    to_snail TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    consumed_by_message_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    consumed_at TEXT,
    FOREIGN KEY (conversation_id) REFERENCES knowledge_governance_conversation(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES knowledge_governance_message(id) ON DELETE CASCADE,
    FOREIGN KEY (consumed_by_message_id) REFERENCES knowledge_governance_message(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS knowledge_use (
    id TEXT PRIMARY KEY,
    knowledge_id TEXT NOT NULL,
    conversation_id TEXT,
    stage_id TEXT,
    snail_name TEXT,
    use_type TEXT NOT NULL,
    outcome TEXT,
    feedback TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (knowledge_id) REFERENCES knowledge_item(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversation(id) ON DELETE SET NULL,
    FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE SET NULL
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(
    conversation_id UNINDEXED,
    message_id UNINDEXED,
    role UNINDEXED,
    from_snail UNINDEXED,
    content
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_search USING fts5(
    knowledge_id UNINDEXED,
    project_id UNINDEXED,
    scope_type UNINDEXED,
    kind UNINDEXED,
    status UNINDEXED,
    title,
    content,
    source_quote
  );

  CREATE INDEX IF NOT EXISTS idx_feature_project_status ON feature(project_id, status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_stage_feature_sequence ON stage(feature_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_conversation_project_stage ON conversation(project_id, stage_id);
  CREATE INDEX IF NOT EXISTS idx_conversation_feature_stage ON conversation(feature_id, stage_id);
  CREATE INDEX IF NOT EXISTS idx_message_conversation_created_at ON message(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_message_event_message_seq ON message_event(message_id, seq);
  CREATE INDEX IF NOT EXISTS idx_message_event_id ON message_event(id);
  CREATE INDEX IF NOT EXISTS idx_message_dispatch_to_status ON message_dispatch(conversation_id, to_snail, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_stage_definition_project ON project_stage_definition(project_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_stage_role_definition_stage ON stage_role_definition(stage_definition_id);
  CREATE INDEX IF NOT EXISTS idx_knowledge_project_status ON knowledge_item(project_id, status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_knowledge_scope ON knowledge_item(scope_type, scope_ref, status);
  CREATE INDEX IF NOT EXISTS idx_knowledge_source_item ON knowledge_source(knowledge_id);
  CREATE INDEX IF NOT EXISTS idx_knowledge_governance_status ON knowledge_governance(entry_check_status, disposition_status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_knowledge_governance_conversation_governance ON knowledge_governance_conversation(governance_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_knowledge_governance_message_conversation ON knowledge_governance_message(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_knowledge_governance_message_event_message_seq ON knowledge_governance_message_event(message_id, seq);
  CREATE INDEX IF NOT EXISTS idx_knowledge_governance_message_dispatch_to_status ON knowledge_governance_message_dispatch(conversation_id, to_snail, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_knowledge_use_item ON knowledge_use(knowledge_id, created_at);
`;
