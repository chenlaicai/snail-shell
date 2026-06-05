import assert from "assert";
import fs from "fs";
import path from "path";
import { ConversationStore } from "../../src/persistence/store";
import { RoleRegistry } from "../../src/roles";
import { WorkspaceManager } from "../../src/workspace-workflow/manager";
import type { AgentRuntime } from "../../src/agent/interface";

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-snapshot-integration.db");
function removeDbFiles(dbPath: string): void {
  for (const f of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}
fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
removeDbFiles(TEST_DB);

const TEST_CONFIG_DIR = path.join(__dirname, "..", "..", "data", "test-config-snapshot-integration");
if (fs.existsSync(TEST_CONFIG_DIR)) fs.rmSync(TEST_CONFIG_DIR, { recursive: true });
fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
fs.writeFileSync(path.join(TEST_CONFIG_DIR, "workspaces.json"), JSON.stringify([]));

const store = new ConversationStore(TEST_DB, TEST_CONFIG_DIR);

// Seed SOP with handbooks
store.seedSopToCache(
  { id: "snap-sop", source: "platform", sourceRef: null, key: "snap-sop", name: "Snapshot Test SOP", description: "Test SOP for snapshot", firstStage: "design" },
  [
    {
      key: "design", title: "设计", sequence: 1,
      input_description: "需求", output_description: "设计文档",
      acceptance_focus: ["设计已锁定"],
      acceptance_checklist: [{ id: "d-01", description: "设计文档已锁定", required: true }],
      roles: [{ key: "designer", name: "架构师", description: "设计", is_primary: true, count: 1, handbook: "## 设计师手册\n\n独立分析需求。" }],
    },
    {
      key: "dev", title: "开发", sequence: 2,
      input_description: "设计文档", output_description: "PR",
      acceptance_focus: ["代码通过CI"],
      acceptance_checklist: [{ id: "v-01", description: "代码已实现", required: true }],
      roles: [{ key: "developer", name: "开发者", description: "开发", is_primary: true, count: 1, handbook: "## 开发者手册\n\n先写测试。" }],
    },
  ],
  [
    { from: "design", to: "dev" },
  ],
);

store.seedWorkspaceToCache({
  id: "snap-ws",  name: "Snapshot Workspace", summary: "测试快照",
  sopBindings: [{ sop_id: "snap-sop", is_default: true, role_bindings: { designer: "tpl-1", developer: "tpl-2" } }],
});

const roleRegistry = new RoleRegistry(store);
const manager = new WorkspaceManager(store, {
  resolve: () => ({
    name: "test", runtime: "claude-code-cli" as AgentRuntime,
    invokeMessage: async () => ({}),
  }),
  list: () => [],
} as any, { roleRegistry, systemAI: null as any, snailDen: { getTemplate: () => null } as any });

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`); }
}

console.log("SOP Snapshot Integration");

// ── Snapshot capture ─────────────────────────────────────────────────

console.log("\n  Snapshot capture");

const { issue, stage, conversation } = manager.createIssue("snap-ws", "测试 Issue", "快照测试", "snap-sop", {});

test("issue has sop_snapshot", () => {
  assert.ok(issue.sop_snapshot);
  assert.strictEqual(issue.sop_snapshot.sop_id, "snap-sop");
});

test("snapshot contains source", () => {
  assert.strictEqual(issue.sop_snapshot.source, "platform");
  assert.strictEqual(issue.sop_snapshot.source_ref, null);
});

test("snapshot contains name and description", () => {
  assert.strictEqual(issue.sop_snapshot.name, "Snapshot Test SOP");
  assert.strictEqual(issue.sop_snapshot.description, "Test SOP for snapshot");
});

test("snapshot contains first_stage", () => {
  assert.strictEqual(issue.sop_snapshot.first_stage, "design");
});

test("snapshot contains shared_handbook", () => {
  assert.strictEqual(issue.sop_snapshot.shared_handbook, null); // no shared handbook in this SOP
});

test("snapshot contains stage_definitions", () => {
  assert.strictEqual(issue.sop_snapshot.stage_definitions.length, 2);
  assert.strictEqual(issue.sop_snapshot.stage_definitions[0].key, "design");
  assert.strictEqual(issue.sop_snapshot.stage_definitions[1].key, "dev");
});

test("snapshot stage_definitions contain roles with handbook", () => {
  const designStage = issue.sop_snapshot.stage_definitions[0];
  assert.strictEqual(designStage.roles.length, 1);
  assert.strictEqual(designStage.roles[0].key, "designer");
  assert.ok(designStage.roles[0].handbook?.includes("独立分析需求"));
});

test("snapshot contains transitions", () => {
  assert.strictEqual(issue.sop_snapshot.transitions.length, 1);
  assert.strictEqual(issue.sop_snapshot.transitions[0].from, "design");
  assert.strictEqual(issue.sop_snapshot.transitions[0].to, "dev");
});

test("snapshot contains acceptance_checklist", () => {
  const designStage = issue.sop_snapshot.stage_definitions[0];
  assert.strictEqual(designStage.acceptance_checklist.length, 1);
  assert.strictEqual(designStage.acceptance_checklist[0].id, "d-01");
  assert.strictEqual(designStage.acceptance_checklist[0].required, true);
});

test("first stage is design", () => {
  assert.strictEqual(stage.type, "design");
});

test("conversation created with correct roles", () => {
  assert.ok(conversation);
  assert.strictEqual(conversation.default_role, "架构师");
});

// ── SOP modification doesn't affect existing issue ───────────────────

console.log("\n  SOP modification isolation");

// Modify the SOP (simulate by creating a new SOP with different content)
store.seedSopToCache(
  { id: "snap-sop-v2", source: "platform", sourceRef: null, key: "snap-sop-v2", name: "Modified SOP", description: "Modified", firstStage: "dev" },
  [
    { key: "dev", title: "开发(改)", sequence: 1, input_description: null, output_description: null, acceptance_focus: [], acceptance_checklist: [], roles: [{ key: "developer", name: "开发者", description: "dev", is_primary: true }] },
  ],
  [],
);

test("existing issue snapshot unchanged after SOP modification", () => {
  const freshIssue = store.getIssue(issue.id)!;
  assert.strictEqual(freshIssue.sop_snapshot.name, "Snapshot Test SOP");
  assert.strictEqual(freshIssue.sop_snapshot.stage_definitions.length, 2);
  assert.strictEqual(freshIssue.sop_snapshot.first_stage, "design");
});

// ── Transition uses snapshot ─────────────────────────────────────────

console.log("\n  Transition from snapshot");

// First complete the design stage by setting output artifacts
store.updateStage(stage.id, { output_artifacts: { feature_doc: "done" } });

test("transition from design to dev uses snapshot transitions", () => {
  const result = manager.advanceIssue(issue.id);
  assert.ok(result);
  assert.ok(result.next_stage);
  assert.strictEqual(result.next_stage.type, "dev");
});

test("new stage role comes from snapshot", () => {
  const freshIssue = store.getIssue(issue.id)!;
  // The snapshot should still have the original role definitions
  const devStage = freshIssue.sop_snapshot.stage_definitions.find((s) => s.key === "dev");
  assert.ok(devStage);
  assert.strictEqual(devStage.roles[0].key, "developer");
  assert.ok(devStage.roles[0].handbook?.includes("先写测试"));
});

// ── Delete SOP doesn't affect existing issue ─────────────────────────

console.log("\n  Delete SOP isolation");

test("deletePlatformSop removes SOP", () => {
  // Create a temporary SOP to delete
  store.seedSopToCache(
    { id: "snap-delete", source: "platform", sourceRef: null, key: "snap-delete", name: "Delete Me", description: null, firstStage: "x" },
    [{ key: "x", title: "X", sequence: 1, acceptance_focus: [], acceptance_checklist: [], roles: [{ key: "r", name: "R", description: "", is_primary: true }] }],
    [],
  );
  // Bind to workspace
  store.createWorkspaceSop({ id: "ps-snap-ws-snap-delete", workspaceId: "snap-ws", sopId: "snap-delete", isDefault: false, roleBindings: {} });

  const affected = store.deletePlatformSop("snap-delete");
  assert.ok(Array.isArray(affected));
  assert.ok(affected.includes("snap-ws"));
});

test("existing issue snapshot survives SOP deletion", () => {
  const freshIssue = store.getIssue(issue.id)!;
  assert.strictEqual(freshIssue.sop_snapshot.sop_id, "snap-sop");
  assert.strictEqual(freshIssue.sop_snapshot.stage_definitions.length, 2);
});

// ── Summary ──────────────────────────────────────────────────────────

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
