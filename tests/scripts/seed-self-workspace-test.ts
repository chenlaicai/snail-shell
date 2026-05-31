import assert from "assert";
import fs from "fs";
import path from "path";
import { ConversationStore } from "../../src/persistence/store";
import { seedSelfWorkspace } from "../../src/workspace-workflow/self-workspace-seed";
import { RoleRegistry } from "../../src/roles";
import type { WorkspaceConfigSeed } from "../../src/persistence/workspace-config-model";

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-seed-self-workspace.db");

function removeDbFiles(dbPath: string): void {
  for (const filePath of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

const SEED: WorkspaceConfigSeed = {
  sops: [{
    sop: { id: "sop-test", scope: "global", key: "test-sop", name: "Test SOP" },
    role_definitions: [
      { id: "role-test-designer", key: "designer", name: "设计者", description: "designer" },
      { id: "role-test-dev", key: "developer", name: "研发者", description: "dev" },
      { id: "role-test-rev", key: "reviewer", name: "检视者", description: "rev" },
      { id: "role-test-merger", key: "merger", name: "合入者", description: "merger" },
    ],
    stage_definitions: [
      { id: "stage-test-design", key: "design", title: "需求对齐与设计", sequence: 1, roles: [{ role_key: "designer", is_primary: true }] },
      { id: "stage-test-dev", key: "development", title: "研发实现", sequence: 2, roles: [{ role_key: "developer", is_primary: true }] },
      { id: "stage-test-rev", key: "review", title: "PR 检视", sequence: 3, roles: [{ role_key: "developer", is_primary: true }, { role_key: "reviewer" }] },
      { id: "stage-test-merge", key: "merge", title: "合入", sequence: 4, roles: [{ role_key: "merger", is_primary: true }] },
    ],
  }],
  workspaces: [{
    workspace: { id: "snail-shell", module: "workspace_management", name: "Snail Shell", summary: "Self workspace", workspace_root: process.cwd() },
    sops: [{ sop_id: "sop-test", is_default: true, role_bindings: { designer: "opencode-default", developer: "opencode-default", reviewer: "opencode-default", merger: "opencode-default" } }],
  }],
};

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
removeDbFiles(TEST_DB);

const store = new ConversationStore(TEST_DB);
const roleRegistry = new RoleRegistry(store);

try {
  store.seedWorkspaceConfigs(SEED);

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
