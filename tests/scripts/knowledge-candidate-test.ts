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

// 初始化 schema + seed knowledge-center 项目（db-bridge 不负责 schema migration / seed）
const initStore = new ConversationStore(TEST_DB);
initStore.seedProjectConfigs([{
  project: { id: "knowledge-center", kind: "system_self", module: "knowledge-governance", name: "Knowledge Center", summary: "知识中心内置项目" },
  stage_definitions: [{ id: "knowledge-center-development", key: "development", title: "研发迭代", sequence: 1, input_description: null, output_description: "完成候选知识治理", acceptance_focus: [], roles: [{ id: "kc-sr-boss", name: "Boss Role", snail_template_id: "opencode-default", is_primary: true, description: "最终决策者", working_rules: [] }, { id: "kc-sr-executor", name: "知识执行者", snail_template_id: "opencode-default", is_primary: false, description: "执行治理流程", working_rules: [] }] }],
}]);
initStore.close();

const payload = {
  project_id: null,
  scope_type: "snail",
  scope_ref: "检视者",
  kind: "constraint",
  title: "检视需具备全链路意识",
  content: "检视者 检视 PR 时必须关注能力上下游是否支撑实际生效。",
  rationale: "用户明确纠偏检视职责边界，具备复用价值。",
  sources: [{ source_type: "message", source_id: "156", quote: "要有全链路意识" }],
};

try {
  const scriptPath = path.join(process.cwd(), ".meta", "skills", "knowledge-candidate", "scripts", "knowledge-candidate.js");
  const output = execFileSync(process.execPath, [scriptPath], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, DB_PATH: TEST_DB },
  });
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
    assert.equal(knowledge.governance?.entry_check_status, "pending_entry_check", "governance should start at entry check");
    const conversation = store.getConversation(result.governance_conversation_id);
    assert.equal(conversation?.project_id, "knowledge-center", "governance conversation should own knowledge-center project");
  } finally {
    store.close();
  }
} finally {
  removeDbFiles(TEST_DB);
}

console.log("knowledge-candidate script tests passed");
