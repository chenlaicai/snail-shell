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
  scope_ref: "Acceptance Snail",
  kind: "rule",
  title: "检视需具备全链路意识",
  content: "Acceptance Snail 检视 PR 时必须关注能力上下游是否支撑实际生效。",
  rationale: "用户明确纠偏检视职责边界，具备复用价值。",
  sources: [{ source_type: "message", source_id: "156", quote: "要有全链路意识" }],
};

try {
  const scriptPath = path.join(process.cwd(), ".meta", "scripts", "knowledge-candidate");
  const output = execFileSync(scriptPath, ["--db-path", TEST_DB], { input: JSON.stringify(payload), encoding: "utf8" });
  const result = JSON.parse(output) as { ok: boolean; knowledge_id: string; status: string; action: string; duplicate_of: string | null };
  assert(result.ok, "script should report success");
  assert.equal(result.status, "candidate", "script should only create candidate knowledge");
  assert.equal(result.action, "created", "first candidate should create a new knowledge item");

  const store = new ConversationStore(TEST_DB);
  try {
    const knowledge = store.getKnowledge(result.knowledge_id)!;
    assert.equal(knowledge.scope_type, "snail", "candidate should preserve explicit scope");
    assert.equal(knowledge.governance_level, "L0", "candidate should stay in manual approval governance level");
    assert.equal(knowledge.sources[0]!.source_id, "156", "candidate should preserve source traceability");

    const duplicatePayload = { ...payload, sources: [{ source_type: "message", source_id: "157", quote: "还是要有全链路意识" }] };
    const duplicateOutput = execFileSync(scriptPath, ["--db-path", TEST_DB], { input: JSON.stringify(duplicatePayload), encoding: "utf8" });
    const duplicateResult = JSON.parse(duplicateOutput) as { ok: boolean; knowledge_id: string; action: string; duplicate_of: string | null };
    assert(duplicateResult.ok, "duplicate script call should report success");
    assert.equal(duplicateResult.knowledge_id, result.knowledge_id, "duplicate candidate should reuse the existing knowledge id");
    assert.equal(duplicateResult.action, "merged", "duplicate candidate should be merged instead of recreated");
    assert.equal(duplicateResult.duplicate_of, result.knowledge_id, "duplicate result should expose the matched knowledge id");
    const merged = store.getKnowledge(result.knowledge_id)!;
    assert.equal(merged.sources.length, 2, "duplicate candidate should append the new source for traceability");
    assert.equal(store.listKnowledge({ status: "candidate" }).filter((item) => item.title === payload.title).length, 1, "duplicate candidate should not create a second pending item");
    assert.equal(store.listKnowledgeUses(result.knowledge_id).filter((item) => item.use_type === "duplicate_candidate").length, 1, "duplicate candidate should be recorded as negative feedback");
  } finally {
    store.close();
  }
} finally {
  removeDbFiles(TEST_DB);
}

console.log("knowledge-candidate script tests passed");
