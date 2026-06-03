import assert from "assert";
import fs from "fs";
import path from "path";
import { ConversationStore } from "../../src/persistence/store";
import { seedSelfWorkspace } from "../../src/workspace-workflow/self-workspace-seed";
import { RoleRegistry } from "../../src/roles";

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-seed-self-workspace.db");

function removeDbFiles(dbPath: string): void {
  for (const filePath of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}


fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
removeDbFiles(TEST_DB);

/** Use a temp config directory to avoid polluting production config/workspaces.json. */
const TEST_CONFIG_DIR = path.join(__dirname, "..", "..", "data", "test-config-seed-self");
fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
fs.writeFileSync(path.join(TEST_CONFIG_DIR, "workspaces.json"), JSON.stringify({ workspaces: [] }));

const store = new ConversationStore(TEST_DB, TEST_CONFIG_DIR);
const roleRegistry = new RoleRegistry(store);

try {
  /* 直接在数据库中创建测试 SOP（模拟从 YAML 加载） */
  store.seedSopToCache({ id: "sop-test", source: "platform", sourceRef: null, key: "test-sop", name: "Test SOP", description: null }, [
    { key: "design", title: "需求对齐与设计", sequence: 1, roles: [{ key: "designer", name: "架构师", description: "designer", is_primary: true }] },
    { key: "development", title: "研发实现", sequence: 2, roles: [{ key: "developer", name: "开发者", description: "dev", is_primary: true }] },
    { key: "review", title: "PR 检视", sequence: 3, roles: [{ key: "developer", name: "开发者", description: "dev", is_primary: true }, { key: "reviewer", name: "审查者", description: "rev" }] },
    { key: "merge", title: "合入", sequence: 4, roles: [{ key: "merger", name: "维护者", description: "merger", is_primary: true }] },
  ]);

  /* Seed workspace 绑定 */
  store.seedWorkspaceToCache({
    id: "snail-shell", module: "workspace_management", name: "Snail Shell", summary: "Self workspace", workspaceRoot: process.cwd(),
    sopBindings: [{ sop_id: "sop-test", is_default: true, role_bindings: { designer: "opencode-default", developer: "opencode-default", reviewer: "opencode-default", merger: "opencode-default" } }],
  });

  const created = seedSelfWorkspace(store, roleRegistry);
  assert.equal(created.created, false, "workspace was created by seedWorkspaceConfigs, seedSelfWorkspace should report created=false");
  assert.equal(created.workspace.name, "Snail Shell");
  assert.equal(created.workspace.workspace_root, process.cwd());
  assert.equal(created.stage?.type, "design");
  assert.equal(created.conversation?.stage_id, created.stage?.id);

  const existing = seedSelfWorkspace(store, roleRegistry);
  assert.equal(existing.created, false, "second call should be idempotent");
  assert.equal(existing.workspace.id, created.workspace.id);
  assert.equal(existing.conversation?.id, created.conversation?.id);
  assert.equal(store.listWorkspaces().filter((p) => p.name === "Snail Shell").length, 1, "no duplicates");
} finally {
  store.close();
  removeDbFiles(TEST_DB);
}
