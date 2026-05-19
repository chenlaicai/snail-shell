import assert from "assert";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { ConversationStore } from "../../src/persistence/store";

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-knowledge-candidate.db");

function removeDbFiles(dbPath: string): void {
  for (const filePath of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
removeDbFiles(TEST_DB);

const payload = {
  project_id: null,
  scope_type: "snail",
  scope_ref: "检视者",
  kind: "rule",
  title: "检视需具备全链路意识",
  content: "检视者 检视 PR 时必须关注能力上下游是否支撑实际生效。",
  rationale: "用户明确纠偏检视职责边界，具备复用价值。",
  sources: [{ source_type: "message", source_id: "156", quote: "要有全链路意识" }],
};

try {
  const scriptPath = path.join(process.cwd(), ".meta", "skills", "knowledge-candidate", "knowledge-candidate");
  const output = execFileSync(scriptPath, ["--db-path", TEST_DB], { input: JSON.stringify(payload), encoding: "utf8" });
  const result = JSON.parse(output) as { ok: boolean; knowledge_id: string; status: string; governance_id: string; governance_conversation_id: string };
  assert(result.ok, "script should report success");
  assert.equal(result.status, "candidate", "script should only create candidate knowledge");

  const store = new ConversationStore(TEST_DB);
  try {
    const knowledge = store.getKnowledge(result.knowledge_id)!;
    assert.equal(knowledge.scope_type, "snail", "candidate should preserve explicit scope");
    assert.equal(knowledge.governance_level, "L0", "candidate should stay in manual approval governance level");
    assert.equal(knowledge.sources[0]!.source_id, "156", "candidate should preserve source traceability");
    assert.equal(knowledge.governance?.id, result.governance_id, "script should return the created governance record");
    assert.equal(knowledge.governance?.conversation?.id, result.governance_conversation_id, "script should return the governance conversation shell");
    assert.equal(knowledge.governance?.entry_check_status, "pending_entry_check", "governance should start at entry check");
  } finally {
    store.close();
  }
} finally {
  removeDbFiles(TEST_DB);
}

console.log("knowledge-candidate script tests passed");
