/**
 * DB Schema — 仅存储运行时状态。
 *
 * 配置类数据（Workspace、SOP、SnailTemplate）走文件，不入 DB。
 * 本文件定义所有表的 DDL，在 DB 初始化时通过 CREATE TABLE IF NOT EXISTS 应用。
 */

export const SCHEMA_SQL = `
-- ═══════════════════════════════════════════════════════════
-- Issue 工作项
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS issue (
  id                  TEXT PRIMARY KEY,                    -- Issue 唯一标识符
  workspace_id        TEXT NOT NULL,                       -- 所属工作区 ID（引用文件配置，无 FK）
  title               TEXT NOT NULL,                       -- Issue 标题
  summary             TEXT,                                -- Issue 摘要
  task_anchor         TEXT,                                -- 结构化目标描述，JSON: {goal, anti_goals?, constraints?}
  sop_snapshot        TEXT NOT NULL,                       -- 冻结的 SOP 快照，JSON: SopSnapshot（Issue 创建时捕获，后续 SOP 变更不影响）
  role_snail_mapping  TEXT NOT NULL,                       -- role_key -> snail_template_id 映射，JSON: Record<string, string>
  created_at          TEXT NOT NULL DEFAULT (datetime('now')), -- 创建时间
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')), -- 最后更新时间
  closed_at           TEXT                                 -- 关闭时间（未关闭时为 NULL）
);

CREATE INDEX IF NOT EXISTS idx_issue_workspace ON issue(workspace_id, closed_at);

-- ═══════════════════════════════════════════════════════════
-- Stage 阶段实例
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS stage (
  id                  TEXT PRIMARY KEY,                    -- 阶段实例唯一标识符
  workspace_id        TEXT NOT NULL,                       -- 所属工作区 ID（引用文件配置，无 FK）
  issue_id            TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE, -- 所属 Issue ID
  stage_definition_id TEXT NOT NULL,                       -- 对应 SOP 中的 stage_definition ID（引用文件配置，无 FK）
  type                TEXT NOT NULL,                       -- 对应 SOP 中的 stage_definition key（如 "design", "development", "review"）
  sequence            INTEGER NOT NULL,                    -- 阶段顺序号（决定阶段排列顺序）
  status              TEXT NOT NULL DEFAULT 'in_progress', -- 阶段状态：in_progress | completed | cancelled
  output_artifacts    TEXT,                                -- 产出物，JSON: Record<string, unknown>
  gate_evidence       TEXT,                                -- 门控证据（AI 自检结果），JSON: {artifacts, checked_at, checked_by}
  entered_at          TEXT NOT NULL DEFAULT (datetime('now')), -- 进入时间
  left_at             TEXT                                 -- 离开时间（进行中时为 NULL）
);

CREATE INDEX IF NOT EXISTS idx_stage_issue ON stage(issue_id, sequence);

-- ═══════════════════════════════════════════════════════════
-- Conversation 对话
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS conversation (
  id                    TEXT PRIMARY KEY,                    -- 对话唯一标识符
  workspace_id          TEXT NOT NULL,                       -- 所属工作区 ID
  issue_id              TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE, -- 所属 Issue ID
  stage_id              TEXT NOT NULL REFERENCES stage(id) ON DELETE CASCADE, -- 绑定的 Stage ID（一个 Stage 绑定一个 Conversation）
  title                 TEXT,                                -- 对话标题
  kind                  TEXT NOT NULL,                       -- 对话类型：discussion | planning | design | implementation | review | bugfix
  status                TEXT NOT NULL DEFAULT 'active',      -- 对话状态：active | paused | completed | archived
  default_role          TEXT NOT NULL,                       -- 默认角色（对话创建时的初始角色）
  participating_roles   TEXT NOT NULL,                       -- 参与角色列表，JSON: string[]
  summary               TEXT,                                -- 对话摘要
  from_conversation_ids TEXT NOT NULL DEFAULT '[]',          -- 对话交接链（来源对话 ID 列表），JSON: string[]
  created_at            TEXT NOT NULL DEFAULT (datetime('now')), -- 创建时间
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))  -- 最后更新时间
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_stage
  ON conversation(stage_id) WHERE stage_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_issue ON conversation(issue_id);

-- ═══════════════════════════════════════════════════════════
-- Message 消息
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS message (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,     -- 消息 ID（自增整数）
  conversation_id     TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE, -- 所属对话 ID
  client_id           TEXT,                                -- 客户端去重 ID（乐观写入防重）
  from_role           TEXT NOT NULL,                       -- 发送角色
  to_roles            TEXT NOT NULL,                       -- 目标角色列表，JSON: string[]
  role                TEXT NOT NULL,                       -- 消息角色：user | assistant | system
  runtime             TEXT NOT NULL,                       -- 产生该消息的运行时：claude-stateful | opencode-stateful | system | unknown
  status              TEXT NOT NULL DEFAULT 'streaming',    -- 消息状态：streaming | completed | failed | interrupted | cancelled | pending_approval
  quoted_message_id   INTEGER REFERENCES message(id),       -- 引用的消息 ID（回复某条消息时使用）
  context_cutoff_at   INTEGER REFERENCES message(id),       -- 上下文截断点（消息 ID，标记上下文窗口边界）
  created_at          TEXT NOT NULL DEFAULT (datetime('now')), -- 创建时间
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))  -- 最后更新时间
);

CREATE INDEX IF NOT EXISTS idx_message_conversation ON message(conversation_id, created_at);

-- ═══════════════════════════════════════════════════════════
-- MessageEvent 消息事件流
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS message_event (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,             -- 事件 ID（自增整数）
  message_id  INTEGER NOT NULL REFERENCES message(id) ON DELETE CASCADE, -- 所属消息 ID
  seq         INTEGER NOT NULL,                             -- 事件序号（消息内的排序）
  category    TEXT NOT NULL,                                -- 事件分类：content | signal
  kind        TEXT NOT NULL,                                -- 事件类型：start | text | content_block | tool_call | tool_result | command | command_result | signal | error
  payload     TEXT NOT NULL,                                -- 事件负载（结构由 kind 决定），JSON: 各种 EventPayload
  source      TEXT,                                        -- 事件来源（运行时溯源），JSON: {runtime, session_id?}
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))        -- 创建时间
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_event_seq
  ON message_event(message_id, seq);

-- ═══════════════════════════════════════════════════════════
-- MessageContext 消息最终上下文
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS message_context (
  message_id  INTEGER PRIMARY KEY REFERENCES message(id) ON DELETE CASCADE, -- 对应的消息 ID（1:1 关系）
  kind        TEXT NOT NULL,                                -- 上下文类型：final_text | message_out | event_summary | llm_summary | mcp_final_body
  context     TEXT NOT NULL,                                -- 可注入 prompt 的上下文文本
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))        -- 最后更新时间
);

-- ═══════════════════════════════════════════════════════════
-- MessageDispatch 消息投递
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS message_dispatch (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT, -- 投递记录 ID（自增整数）
  conversation_id         TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE, -- 所属对话 ID
  message_id              INTEGER NOT NULL REFERENCES message(id) ON DELETE CASCADE, -- 对应的消息 ID
  to_role                 TEXT NOT NULL,                     -- 目标角色
  status                  TEXT NOT NULL DEFAULT 'pending',    -- 投递状态：pending | seen | consumed | skipped
  consumed_by_message_id  INTEGER REFERENCES message(id),    -- 消费该投递的回复消息 ID（角色回复时关联）
  created_at              TEXT NOT NULL DEFAULT (datetime('now')), -- 创建时间
  consumed_at             TEXT                               -- 消费时间（未消费时为 NULL）
);

CREATE INDEX IF NOT EXISTS idx_dispatch_inbox
  ON message_dispatch(conversation_id, to_role, status);

-- ═══════════════════════════════════════════════════════════
-- AgentSession 运行时会话
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agent_session (
  id                  TEXT PRIMARY KEY,                     -- 会话唯一标识符
  conversation_id     TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE, -- 绑定的对话 ID
  role_key            TEXT NOT NULL,                        -- 绑定的角色 key
  runtime             TEXT NOT NULL,                        -- 运行时类型：claude-stateful | opencode-stateful
  external_session_id TEXT,                                -- 外部运行时会话 ID（用于有状态会话恢复）
  handoff_from_id     TEXT REFERENCES agent_session(id),    -- 交接来源会话 ID（会话链）
  created_at          TEXT NOT NULL DEFAULT (datetime('now')) -- 创建时间
);

CREATE INDEX IF NOT EXISTS idx_agent_session_lookup
  ON agent_session(conversation_id, role_key, created_at);

-- ═══════════════════════════════════════════════════════════
-- EvolutionItem 演进项
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS evolution_item (
  id            TEXT PRIMARY KEY,                           -- 演进项唯一标识符
  workspace_id  TEXT NOT NULL,                              -- 所属工作区 ID
  issue_id      TEXT REFERENCES issue(id) ON DELETE SET NULL, -- 关联 Issue ID（可选，删除 Issue 时置 NULL）
  type          TEXT NOT NULL,                              -- 演进项类型：lesson | decision | bug | idea
  status        TEXT NOT NULL DEFAULT 'draft',              -- 演进项状态：draft | review | published | archived
  title         TEXT NOT NULL,                              -- 标题
  content       TEXT NOT NULL,                              -- 内容
  tags          TEXT NOT NULL DEFAULT '[]',                 -- 标签列表，JSON: string[]
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),     -- 创建时间
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))      -- 最后更新时间
);

CREATE INDEX IF NOT EXISTS idx_evolution_workspace ON evolution_item(workspace_id, status);

-- ═══════════════════════════════════════════════════════════
-- KnowledgeEntry 知识条目
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS knowledge_entry (
  id                  TEXT PRIMARY KEY,                     -- 知识条目唯一标识符
  workspace_id        TEXT,                                -- 所属工作区 ID（global 作用域时为 NULL）
  scope               TEXT NOT NULL,                        -- 作用域：global | workspace
  title               TEXT NOT NULL,                        -- 标题
  content             TEXT NOT NULL,                        -- 内容
  source_evolution_id TEXT REFERENCES evolution_item(id) ON DELETE SET NULL, -- 来源演进项 ID
  tags                TEXT NOT NULL DEFAULT '[]',           -- 标签列表，JSON: string[]
  created_at          TEXT NOT NULL DEFAULT (datetime('now')), -- 创建时间
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))  -- 最后更新时间
);

CREATE INDEX IF NOT EXISTS idx_knowledge_scope ON knowledge_entry(scope, workspace_id);
`;
