export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS project (
    id TEXT PRIMARY KEY,
    module TEXT NOT NULL DEFAULT 'project_management',
    name TEXT NOT NULL,
    summary TEXT,
    project_root TEXT NOT NULL,
    status TEXT NOT NULL,
    guard_profile TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sop (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    scope_ref TEXT,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    source_sop_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sop_global_key ON sop(key) WHERE scope = 'global';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sop_project_key ON sop(scope_ref, key) WHERE scope = 'project';

  CREATE TABLE IF NOT EXISTS role_definition (
    id TEXT PRIMARY KEY,
    sop_id TEXT NOT NULL,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    handbook_prompt_ref TEXT,
    working_rules TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY (sop_id) REFERENCES sop(id) ON DELETE CASCADE,
    UNIQUE(sop_id, key),
    UNIQUE(sop_id, name)
  );

  CREATE TABLE IF NOT EXISTS stage_definition (
    id TEXT PRIMARY KEY,
    sop_id TEXT NOT NULL,
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    input_description TEXT,
    output_description TEXT,
    acceptance_focus TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY (sop_id) REFERENCES sop(id) ON DELETE CASCADE,
    UNIQUE(sop_id, key),
    UNIQUE(sop_id, sequence)
  );

  CREATE TABLE IF NOT EXISTS stage_role (
    id TEXT PRIMARY KEY,
    stage_definition_id TEXT NOT NULL,
    role_definition_id TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0,
    working_rules_override TEXT,
    FOREIGN KEY (stage_definition_id) REFERENCES stage_definition(id) ON DELETE CASCADE,
    FOREIGN KEY (role_definition_id) REFERENCES role_definition(id) ON DELETE CASCADE,
    UNIQUE(stage_definition_id, role_definition_id)
  );

  CREATE TABLE IF NOT EXISTS project_sop (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    sop_id TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    role_bindings TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
    FOREIGN KEY (sop_id) REFERENCES sop(id) ON DELETE CASCADE,
    UNIQUE(project_id, sop_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_project_sop_default ON project_sop(project_id) WHERE is_default = 1;

  CREATE TABLE IF NOT EXISTS feature (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    task_anchor TEXT,
    adopted_sop_id TEXT,
    role_snail_mapping TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT,
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
    FOREIGN KEY (adopted_sop_id) REFERENCES sop(id)
  );

  CREATE TABLE IF NOT EXISTS stage (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    feature_id TEXT NOT NULL,
    stage_definition_id TEXT NOT NULL,
    type TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    status TEXT NOT NULL,
    output_artifacts TEXT NOT NULL DEFAULT '{}',
    entered_at TEXT,
    left_at TEXT,
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
    FOREIGN KEY (feature_id) REFERENCES feature(id) ON DELETE CASCADE,
    FOREIGN KEY (stage_definition_id) REFERENCES stage_definition(id),
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
    default_role TEXT NOT NULL,
    participating_roles TEXT NOT NULL DEFAULT '[]',
    summary TEXT,
    from_conversation_ids TEXT NOT NULL DEFAULT '[]',
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
    from_role TEXT,
    to_roles TEXT NOT NULL DEFAULT '[]',
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
    to_role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    consumed_by_message_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    consumed_at TEXT,
    FOREIGN KEY (conversation_id) REFERENCES conversation(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES message(id) ON DELETE CASCADE,
    FOREIGN KEY (consumed_by_message_id) REFERENCES message(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS snail_agent_session (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role_name TEXT NOT NULL,
    runtime TEXT NOT NULL,
    model TEXT NOT NULL,
    context_provider TEXT NOT NULL,
    external_session_id TEXT,
    handoff_from_id TEXT REFERENCES snail_agent_session(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversation(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS evolution_item (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    feature_id TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    disposition_note TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
    FOREIGN KEY (feature_id) REFERENCES feature(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS knowledge_library (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT 'project',
    project_id TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    source_evolution_item_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
    FOREIGN KEY (source_evolution_item_id) REFERENCES evolution_item(id) ON DELETE SET NULL
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(
    conversation_id UNINDEXED,
    message_id UNINDEXED,
    role UNINDEXED,
    from_role UNINDEXED,
    content
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS evolution_item_search USING fts5(
    evolution_item_id UNINDEXED,
    project_id UNINDEXED,
    status UNINDEXED,
    title,
    content
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_library_search USING fts5(
    entry_id UNINDEXED,
    scope UNINDEXED,
    project_id UNINDEXED,
    status UNINDEXED,
    title,
    content
  );

  CREATE INDEX IF NOT EXISTS idx_feature_project_closed ON feature(project_id, closed_at, updated_at);
  CREATE INDEX IF NOT EXISTS idx_stage_feature_sequence ON stage(feature_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_conversation_project_stage ON conversation(project_id, stage_id);
  CREATE INDEX IF NOT EXISTS idx_conversation_feature_stage ON conversation(feature_id, stage_id);
  CREATE INDEX IF NOT EXISTS idx_conversation_owner ON conversation(owner_type, owner_id);
  CREATE INDEX IF NOT EXISTS idx_message_conversation_created_at ON message(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_message_event_message_seq ON message_event(message_id, seq);
  CREATE INDEX IF NOT EXISTS idx_message_event_id ON message_event(id);
  CREATE INDEX IF NOT EXISTS idx_message_dispatch_to_status ON message_dispatch(conversation_id, to_role, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_snail_agent_session_lookup ON snail_agent_session(conversation_id, role_name, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_stage_definition_sop ON stage_definition(sop_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_stage_role_stage ON stage_role(stage_definition_id);
  CREATE INDEX IF NOT EXISTS idx_role_definition_sop ON role_definition(sop_id);
  CREATE INDEX IF NOT EXISTS idx_evolution_item_project_status ON evolution_item(project_id, status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_evolution_item_feature ON evolution_item(feature_id);
  CREATE INDEX IF NOT EXISTS idx_knowledge_library_scope_project ON knowledge_library(scope, project_id, status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_knowledge_library_source ON knowledge_library(source_evolution_item_id);

  -- ── Feature Chain Index ────────────────────────────────
  CREATE TABLE IF NOT EXISTS feature_chain_index (
    feature_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    from_ids TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    modules TEXT NOT NULL DEFAULT '[]',
    doc_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS feature_chain_search USING fts5(
    feature_id UNINDEXED,
    title,
    summary,
    tags,
    modules,
    body
  );

  CREATE TABLE IF NOT EXISTS feature_chain_backlink (
    feature_id TEXT NOT NULL,
    from_feature_id TEXT NOT NULL,
    PRIMARY KEY (feature_id, from_feature_id)
  );

  CREATE INDEX IF NOT EXISTS idx_feature_chain_backlink_from ON feature_chain_backlink(from_feature_id);
`;

/**
 * 返回当前 schema 文件的版本标识。
 *
 * 版本来源为 src/persistence/schema.ts 在 git 仓库中最近一次 commit 的 short hash 与日期。
 * 运行时无 git 环境时返回 "UNKNOWN"，不抛出异常。
 *
 * 格式示例: "3824365 2026-05-24"
 */
export function getSchemaVersion(): string {
  try {
    const { execSync } = require("child_process");
    const result = execSync(
      'git log -1 --format="%h %ad" --date=short -- src/persistence/schema.ts',
      { cwd: process.cwd(), encoding: "utf8", timeout: 5000 }
    ).trim();
    return result || "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}
