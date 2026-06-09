/**
 * SQLite Schema 管理器实现
 *
 * 基于 better-sqlite3 实现 Schema 版本管理和迁移。
 */

import type { DatabaseConnection } from "../connection/types";
import type { SchemaManager, SchemaVersion } from "./types";

/**
 * Schema 版本表名
 */
const SCHEMA_VERSION_TABLE = "schema_version";

/**
 * SQLite Schema 管理器
 */
export class SqliteSchemaManager implements SchemaManager {
  private migrations: SchemaVersion[] = [];

  constructor(private connection: DatabaseConnection) {
    this.initializeMigrations();
  }

  /**
   * 初始化迁移列表
   */
  private initializeMigrations(): void {
    this.migrations = [
      {
        version: 1,
        description: "Initial schema",
        sql: `
          CREATE TABLE IF NOT EXISTS ${SCHEMA_VERSION_TABLE} (
            version INTEGER PRIMARY KEY,
            description TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
          );

          CREATE TABLE IF NOT EXISTS workspace (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            summary TEXT,
            workspace_root TEXT NOT NULL,
            guard_profile TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );

          CREATE TABLE IF NOT EXISTS issue (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT,
            task_anchor TEXT,
            sop_snapshot TEXT NOT NULL DEFAULT '{}',
            role_snail_mapping TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            closed_at TEXT,
            FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS stage (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            issue_id TEXT NOT NULL,
            stage_definition_id TEXT NOT NULL,
            type TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            status TEXT NOT NULL,
            output_artifacts TEXT NOT NULL DEFAULT '{}',
            gate_evidence TEXT,
            entered_at TEXT,
            left_at TEXT,
            FOREIGN KEY (issue_id) REFERENCES issue(id) ON DELETE CASCADE,
            UNIQUE(issue_id, sequence)
          );

          CREATE TABLE IF NOT EXISTS conversation (
            id TEXT PRIMARY KEY,
            workspace_id TEXT,
            issue_id TEXT,
            stage_id TEXT,
            owner_type TEXT NOT NULL DEFAULT 'workspace_stage',
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
            FOREIGN KEY (issue_id) REFERENCES issue(id) ON DELETE CASCADE,
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
            workspace_id TEXT NOT NULL,
            issue_id TEXT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]',
            metadata TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (issue_id) REFERENCES issue(id) ON DELETE SET NULL
          );

          CREATE TABLE IF NOT EXISTS knowledge_library (
            id TEXT PRIMARY KEY,
            scope TEXT NOT NULL DEFAULT 'workspace',
            workspace_id TEXT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            source_evolution_item_id TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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
            workspace_id UNINDEXED,
            title,
            content
          );

          CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_library_search USING fts5(
            entry_id UNINDEXED,
            scope UNINDEXED,
            workspace_id UNINDEXED,
            title,
            content
          );

          CREATE INDEX IF NOT EXISTS idx_issue_workspace_closed ON issue(workspace_id, closed_at, updated_at);
          CREATE INDEX IF NOT EXISTS idx_stage_issue_sequence ON stage(issue_id, sequence);
          CREATE INDEX IF NOT EXISTS idx_conversation_workspace_stage ON conversation(workspace_id, stage_id);
          CREATE INDEX IF NOT EXISTS idx_conversation_issue_stage ON conversation(issue_id, stage_id);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_stage_unique ON conversation(stage_id) WHERE stage_id IS NOT NULL;
          CREATE INDEX IF NOT EXISTS idx_conversation_owner ON conversation(owner_type, owner_id);
          CREATE INDEX IF NOT EXISTS idx_message_conversation_created_at ON message(conversation_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_message_event_message_seq ON message_event(message_id, seq);
          CREATE INDEX IF NOT EXISTS idx_message_event_id ON message_event(id);
          CREATE INDEX IF NOT EXISTS idx_message_dispatch_to_status ON message_dispatch(conversation_id, to_role, status, created_at);
          CREATE INDEX IF NOT EXISTS idx_snail_agent_session_lookup ON snail_agent_session(conversation_id, role_name, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_evolution_item_workspace ON evolution_item(workspace_id, updated_at);
          CREATE INDEX IF NOT EXISTS idx_evolution_item_issue ON evolution_item(issue_id);
          CREATE INDEX IF NOT EXISTS idx_knowledge_library_scope_workspace ON knowledge_library(scope, workspace_id, updated_at);
          CREATE INDEX IF NOT EXISTS idx_knowledge_library_source ON knowledge_library(source_evolution_item_id);

          -- SOP 配置表
          CREATE TABLE IF NOT EXISTS sop (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            source_ref TEXT,
            key TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            first_stage TEXT,
            shared_handbook TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );

          CREATE TABLE IF NOT EXISTS sop_stage_definition (
            id TEXT PRIMARY KEY,
            sop_id TEXT NOT NULL,
            key TEXT NOT NULL,
            title TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            input_description TEXT,
            output_description TEXT,
            acceptance_focus TEXT NOT NULL DEFAULT '[]',
            acceptance_checklist TEXT NOT NULL DEFAULT '[]',
            FOREIGN KEY (sop_id) REFERENCES sop(id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS sop_stage_role_definition (
            id TEXT PRIMARY KEY,
            stage_definition_id TEXT NOT NULL,
            key TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            handbook TEXT,
            is_primary INTEGER NOT NULL DEFAULT 0,
            count INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (stage_definition_id) REFERENCES sop_stage_definition(id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS sop_transition (
            id TEXT PRIMARY KEY,
            sop_id TEXT NOT NULL,
            from_stage_key TEXT NOT NULL,
            to_stage_key TEXT NOT NULL,
            guard TEXT,
            FOREIGN KEY (sop_id) REFERENCES sop(id) ON DELETE CASCADE
          );

          CREATE UNIQUE INDEX IF NOT EXISTS idx_sop_source_key ON sop(source, key);
          CREATE INDEX IF NOT EXISTS idx_sop_stage_definition_sop ON sop_stage_definition(sop_id, sequence);
          CREATE INDEX IF NOT EXISTS idx_sop_transition_sop ON sop_transition(sop_id, from_stage_key);
        `,
      },
      {
        version: 2,
        description: "Add feature chain and lobby tables",
        sql: `
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

          CREATE TABLE IF NOT EXISTS lobby_session (
            id TEXT PRIMARY KEY,
            channel_type TEXT NOT NULL,
            channel_chat_id TEXT NOT NULL,
            channel_tenant_key TEXT,
            navigation_level TEXT NOT NULL DEFAULT 'lobby',
            current_workspace_id TEXT,
            current_issue_id TEXT,
            current_stage_id TEXT,
            current_conversation_id TEXT,
            last_command_at TEXT NOT NULL DEFAULT (datetime('now')),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(channel_type, channel_chat_id, channel_tenant_key)
          );

          CREATE TABLE IF NOT EXISTS lobby_message (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lobby_session_id TEXT NOT NULL,
            direction TEXT NOT NULL,
            command TEXT,
            content TEXT NOT NULL,
            response_content TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (lobby_session_id) REFERENCES lobby_session(id) ON DELETE CASCADE
          );

          CREATE INDEX IF NOT EXISTS idx_lobby_session_channel ON lobby_session(channel_type, channel_chat_id);
          CREATE INDEX IF NOT EXISTS idx_lobby_session_conversation ON lobby_session(current_conversation_id);
          CREATE INDEX IF NOT EXISTS idx_lobby_message_session ON lobby_message(lobby_session_id, created_at);
        `,
      },
    ];
  }

  async getVersion(): Promise<number> {
    try {
      const result = await this.connection.query<{ version: number }>(
        `SELECT MAX(version) as version FROM ${SCHEMA_VERSION_TABLE}`
      );
      return result.rows[0]?.version ?? 0;
    } catch {
      // 表不存在，返回 0
      return 0;
    }
  }

  async migrate(targetVersion?: number): Promise<number> {
    const currentVersion = await this.getVersion();
    const target = targetVersion ?? Math.max(...this.migrations.map((m) => m.version));

    if (currentVersion >= target) {
      return currentVersion;
    }

    // 按版本号排序迁移
    const pendingMigrations = this.migrations
      .filter((m) => m.version > currentVersion && m.version <= target)
      .sort((a, b) => a.version - b.version);

    for (const migration of pendingMigrations) {
      await this.connection.transaction(async () => {
        // 执行迁移 SQL
        const statements = migration.sql
          .split(";")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        for (const statement of statements) {
          await this.connection.execute(statement);
        }

        // 记录迁移版本
        await this.connection.execute(
          `INSERT OR REPLACE INTO ${SCHEMA_VERSION_TABLE} (version, description) VALUES (?, ?)`,
          [migration.version, migration.description]
        );
      });
    }

    return target;
  }

  async needsMigration(): Promise<boolean> {
    const currentVersion = await this.getVersion();
    const latestVersion = Math.max(...this.migrations.map((m) => m.version));
    return currentVersion < latestVersion;
  }

  getAvailableMigrations(): SchemaVersion[] {
    return [...this.migrations];
  }
}
