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
  assert.equal(created.feature?.status, "active", "default feature should start active");
  assert.equal(created.stage?.type, "development", "active stage should use the first workflow stage");
  assert.equal(created.conversation?.stage_id, created.stage?.id, "default conversation should belong to the active stage");
  const extraConversation = store.createConversation({
    id: " extra-conversation",
    projectId: created.project.id,
    featureId: created.feature!.id,
    stageId: created.stage!.id,
    title: "Later discussion",
    kind: "discussion",
    defaultSnail: created.conversation!.default_snail,
    participatingSnails: created.conversation!.participating_snails,
  });
  store.updateConversation(extraConversation.id, { summary: "Updated later discussion" });

  const existing = seedSelfProject(store, snailRegistry);
  assert.equal(existing.created, false, "second seed run should be idempotent");
  assert.equal(existing.project.id, created.project.id, "second seed run should return the existing project");
  assert.equal(existing.conversation?.id, created.conversation?.id, "second seed run should return the initial conversation");
  assert.equal(store.listProjects().filter((project) => project.name === "Snail Shell" && project.kind === "system_self").length, 1, "seed should not duplicate the default project");
} finally {
  store.close();
  removeDbFiles(TEST_DB);
}
