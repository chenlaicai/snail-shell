import assert from "assert";
import fs from "fs";
import path from "path";
import { ConversationStore } from "../../src/persistence/store";
import { seedSelfProject } from "../../src/project/self-project-seed";
import { SnailRegistry } from "../../src/snails";

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-seed-self-project.db");

function removeDbFiles(dbPath: string): void {
  for (const filePath of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
removeDbFiles(TEST_DB);

const store = new ConversationStore(TEST_DB);
const snailRegistry = new SnailRegistry();

try {
  const created = seedSelfProject(store, snailRegistry);
  assert.equal(created.created, true, "first seed run should create the project");
  assert.equal(created.project.name, "Snail Shell", "project name should match the default self project");
  assert.equal(created.project.kind, "system_self", "project kind should be system_self");
  assert.equal(created.stage?.type, "development", "active stage should use the first workflow stage");
  assert.equal(created.conversation?.stage_id, created.stage?.id, "default conversation should belong to the active stage");

  const existing = seedSelfProject(store, snailRegistry);
  assert.equal(existing.created, false, "second seed run should be idempotent");
  assert.equal(existing.project.id, created.project.id, "second seed run should return the existing project");
  assert.equal(existing.conversation?.id, created.conversation?.id, "second seed run should return the existing conversation");
  assert.equal(store.listProjects().filter((project) => project.name === "Snail Shell" && project.kind === "system_self").length, 1, "seed should not duplicate the default project");
} finally {
  store.close();
  removeDbFiles(TEST_DB);
}
