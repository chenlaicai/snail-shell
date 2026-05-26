import assert from "assert";
import fs from "fs";
import path from "path";
import { ConversationStore } from "../../src/persistence/store";
import { seedSelfProject } from "../../src/project-workflow/self-project-seed";
import { RoleRegistry } from "../../src/roles";
import type { ProjectConfigSeed } from "../../src/persistence/project-config-model";

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-seed-self-project.db");

function removeDbFiles(dbPath: string): void {
  for (const filePath of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

const SEED: ProjectConfigSeed = {
  sops: [{
    sop: { id: "sop-test", scope: "global", key: "test-sop", name: "Test SOP" },
    role_definitions: [
      { id: "role-test-dev", key: "developer", name: "研发者", description: "dev" },
      { id: "role-test-rev", key: "reviewer", name: "检视者", description: "rev" },
    ],
    stage_definitions: [
      { id: "stage-test-dev", key: "development", title: "研发迭代", sequence: 1, roles: [{ role_key: "developer", is_primary: true }] },
      { id: "stage-test-rev", key: "review", title: "PR 检视", sequence: 2, roles: [{ role_key: "developer", is_primary: true }, { role_key: "reviewer" }] },
    ],
  }],
  projects: [{
    project: { id: "snail-shell", module: "project_management", name: "Snail Shell", summary: "Self project", project_root: process.cwd() },
    sops: [{ sop_id: "sop-test", is_default: true, role_bindings: { developer: "opencode-default", reviewer: "opencode-default" } }],
  }],
};

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
removeDbFiles(TEST_DB);

const store = new ConversationStore(TEST_DB);
const roleRegistry = new RoleRegistry(store);

try {
  store.seedProjectConfigs(SEED);

  const created = seedSelfProject(store, roleRegistry);
  assert.equal(created.created, false, "project was created by seedProjectConfigs, seedSelfProject should report created=false");
  assert.equal(created.project.name, "Snail Shell");
  assert.equal(created.project.project_root, process.cwd());
  assert.equal(created.stage?.type, "development");
  assert.equal(created.conversation?.stage_id, created.stage?.id);

  const existing = seedSelfProject(store, roleRegistry);
  assert.equal(existing.created, false, "second call should be idempotent");
  assert.equal(existing.project.id, created.project.id);
  assert.equal(existing.conversation?.id, created.conversation?.id);
  assert.equal(store.listProjects().filter((p) => p.name === "Snail Shell").length, 1, "no duplicates");
} finally {
  store.close();
  removeDbFiles(TEST_DB);
}
