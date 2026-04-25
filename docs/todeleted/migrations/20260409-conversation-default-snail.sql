BEGIN TRANSACTION;

CREATE TABLE conversation_new (
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
  FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE CASCADE
);

INSERT INTO conversation_new (
  id,
  project_id,
  stage_id,
  title,
  kind,
  status,
  default_snail,
  participating_snails,
  summary,
  from_conversation_ids,
  created_at,
  updated_at
)
SELECT
  id,
  project_id,
  stage_id,
  title,
  kind,
  status,
  snail_name,
  participating_snails,
  summary,
  from_conversation_ids,
  created_at,
  updated_at
FROM conversation;

DROP TABLE conversation;
ALTER TABLE conversation_new RENAME TO conversation;

CREATE INDEX IF NOT EXISTS idx_conversation_project_stage ON conversation(project_id, stage_id);

ALTER TABLE message ADD COLUMN snail_name TEXT;

COMMIT;
