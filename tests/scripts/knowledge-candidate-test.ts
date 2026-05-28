import assert from "assert";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { ConversationStore } from "../../src/persistence/store";

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-evolution-candidate.db");

function removeDbFiles(dbPath: string): void {
  for (const filePath of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
removeDbFiles(TEST_DB);

// 初始化 schema + seed evolution-center 项目（db-bridge 不负责 schema migration / seed）
const initStore = new ConversationStore(TEST_DB);
initStore.seedProjectConfigs({
  sops: [{
    sop: { id: "sop-evolution-candidate-test", scope: "global", key: "evolution-candidate-test-sop", name: "Evolution Center SOP" },
    role_definitions: [
      { id: "role-evolution-ct-boss", key: "boss", name: "Boss Role", description: "最终决策者", working_rules: [] },
      { id: "role-evolution-ct-executor", key: "evolution-executor", name: "演进执行者", description: "执行治理流程", working_rules: [] },
    ],
    stage_definitions: [
      { id: "evolution-center-development", key: "development", title: "演进治理", sequence: 1, input_description: null, output_description: "完成演进项治理", acceptance_focus: [], roles: [{ role_key: "boss", is_primary: true }, { role_key: "evolution-executor" }] },
    ],
  }],
  projects: [{
    project: { id: "snail-shell", module: "project_management", name: "Snail Shell", summary: "默认项目", project_root: process.cwd() },
    sops: [{ sop_id: "sop-evolution-candidate-test", is_default: true, role_bindings: { "boss": "opencode-default", "evolution-executor": "opencode-default" } }],
  }, {
    project: { id: "evolution-center", module: "evolution", name: "Evolution Center", summary: "演进中心内置项目", project_root: process.cwd() },
    sops: [{ sop_id: "sop-evolution-candidate-test", is_default: true, role_bindings: { "boss": "opencode-default", "evolution-executor": "opencode-default" } }],
  }],
});
initStore.close();

const payload = {
  project_id: "snail-shell",
  title: "检视需具备全链路意识",
  content: "检视者 检视 PR 时必须关注能力上下游是否支撑实际生效。",
  tags: ["检视", "规则"],
};

try {
  const scriptPath = path.join(process.cwd(), ".meta", "skills", "evolution-candidate", "scripts", "evolution-candidate.js");
  const output = execFileSync(process.execPath, [scriptPath], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, DB_PATH: TEST_DB },
  });
  const result = JSON.parse(output) as { ok: boolean; evolution_item_id: string; status: string };
  assert(result.ok, "script should report success");
  assert.equal(result.status, "pending", "script should only create pending evolution item");

  const store = new ConversationStore(TEST_DB);
  try {
    const evolutionItem = store.getEvolutionItem(result.evolution_item_id)!;
    assert.equal(evolutionItem.project_id, "snail-shell", "evolution item should preserve project id");
    assert.equal(evolutionItem.tags.length, 2, "evolution item should preserve tags");
    assert.equal(evolutionItem.status, "pending", "evolution item should be pending");
    const conversation = store.getConversation(evolutionItem.conversation!.id);
    assert.equal(conversation?.project_id, "snail-shell", "evolution conversation should inherit project from evolution item");
  } finally {
    store.close();
  }
} finally {
  removeDbFiles(TEST_DB);
}

console.log("evolution-candidate script tests passed");
