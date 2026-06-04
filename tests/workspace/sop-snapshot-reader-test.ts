import assert from "assert";
import { SopSnapshotReader } from "../../src/workspace-workflow/sop-snapshot-reader";
import type { SopSnapshot } from "../../src/shared/types";

// ── Test fixtures ────────────────────────────────────────────────────

const FULL_SNAPSHOT: SopSnapshot = {
  sop_id: "code-delivery",
  source: "platform",
  source_ref: null,
  name: "代码交付流程",
  description: "标准软件研发交付流程",
  first_stage: "design",
  shared_handbook: "## 通用规则\n\n所有角色共用。",
  stage_definitions: [
    {
      key: "design",
      title: "需求对齐与设计",
      sequence: 1,
      input_description: "用户需求描述。",
      output_description: "锁定的 Feature 文档",
      acceptance_focus: ["设计方案已锁定"],
      acceptance_checklist: [
        { id: "design-01", description: "Feature 文档已锁定", required: true },
        { id: "design-02", description: "无未解决争议", required: false },
      ],
      roles: [
        { key: "designer", name: "架构师", description: "负责设计", is_primary: true, count: 2, handbook: "## 设计师手册\n\n独立分析需求。" },
      ],
    },
    {
      key: "development",
      title: "研发实现",
      sequence: 2,
      input_description: "锁定的 Feature 文档",
      output_description: "PR 已提交",
      acceptance_focus: ["代码通过 CI"],
      acceptance_checklist: [
        { id: "dev-01", description: "代码已实现", required: true },
      ],
      roles: [
        { key: "developer", name: "开发者", description: "负责实现", is_primary: true, count: 1, handbook: "## 开发者手册\n\n先写测试再实现。" },
      ],
    },
    {
      key: "review",
      title: "PR 检视",
      sequence: 3,
      input_description: "PR",
      output_description: "检视完成",
      acceptance_focus: [],
      acceptance_checklist: [],
      roles: [
        { key: "developer", name: "开发者", description: "回应检视", is_primary: true, count: 1, handbook: null },
        { key: "reviewer", name: "审查者", description: "代码检视", is_primary: false, count: 2, handbook: "## 审查者手册\n\n对抗性检视。" },
      ],
    },
  ],
  transitions: [
    { from: "design", to: "development", guard: null },
    { from: "development", to: "review", guard: null },
    { from: "review", to: "development", guard: { type: "requires_artifacts", config: { artifacts: ["fix_pr_url"] } } },
  ],
};

const WORKSPACE_SNAPSHOT: SopSnapshot = {
  ...FULL_SNAPSHOT,
  sop_id: "ws-uuid#custom-sop",
  source: "workspace",
  source_ref: "ws-uuid",
};

const EMPTY_SNAPSHOT: SopSnapshot = {
  sop_id: "",
  source: "platform",
  source_ref: null,
  name: "",
  description: null,
  first_stage: null,
  shared_handbook: null,
  stage_definitions: [],
  transitions: [],
};

// ── Tests ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log("SopSnapshotReader");

// ── Constructor validation ───────────────────────────────────────────

console.log("\n  Constructor");

test("throws on empty sop_id", () => {
  assert.throws(() => new SopSnapshotReader(EMPTY_SNAPSHOT), /no SOP snapshot/);
});

test("accepts valid platform snapshot", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  assert.ok(reader);
});

test("accepts valid workspace snapshot", () => {
  const reader = new SopSnapshotReader(WORKSPACE_SNAPSHOT);
  assert.ok(reader);
});

// ── getSop ───────────────────────────────────────────────────────────

console.log("\n  getSop()");

test("returns correct SOP metadata", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  const sop = reader.getSop();
  assert.strictEqual(sop.id, "code-delivery");
  assert.strictEqual(sop.source, "platform");
  assert.strictEqual(sop.source_ref, null);
  assert.strictEqual(sop.name, "代码交付流程");
  assert.strictEqual(sop.description, "标准软件研发交付流程");
  assert.strictEqual(sop.first_stage, "design");
  assert.strictEqual(sop.shared_handbook, "## 通用规则\n\n所有角色共用。");
});

test("returns workspace source for workspace SOP", () => {
  const reader = new SopSnapshotReader(WORKSPACE_SNAPSHOT);
  const sop = reader.getSop();
  assert.strictEqual(sop.source, "workspace");
  assert.strictEqual(sop.source_ref, "ws-uuid");
});

// ── getSopStageDefinitionByKey ───────────────────────────────────────

console.log("\n  getSopStageDefinitionByKey()");

test("returns stage definition by key", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  const sd = reader.getSopStageDefinitionByKey("design");
  assert.ok(sd);
  assert.strictEqual(sd.key, "design");
  assert.strictEqual(sd.title, "需求对齐与设计");
  assert.strictEqual(sd.sequence, 1);
  assert.strictEqual(sd.sop_id, "code-delivery");
  assert.strictEqual(sd.id, "sd-code-delivery-design");
});

test("returns undefined for unknown key", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  assert.strictEqual(reader.getSopStageDefinitionByKey("nonexistent"), undefined);
});

// ── listSopStageDefinitions ──────────────────────────────────────────

console.log("\n  listSopStageDefinitions()");

test("returns all stages sorted by sequence", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  const stages = reader.listSopStageDefinitions();
  assert.strictEqual(stages.length, 3);
  assert.strictEqual(stages[0].key, "design");
  assert.strictEqual(stages[1].key, "development");
  assert.strictEqual(stages[2].key, "review");
});

// ── listSopStageDefinitionsWithRoles ─────────────────────────────────

console.log("\n  listSopStageDefinitionsWithRoles()");

test("returns stages with inline roles", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  const stages = reader.listSopStageDefinitionsWithRoles();
  assert.strictEqual(stages.length, 3);
  // design stage: designer with count=2 expands to 2 instances
  assert.strictEqual(stages[0].roles.length, 2);
  assert.strictEqual(stages[0].roles[0].key, "designer");
  assert.strictEqual(stages[0].roles[0].count, 2);
  assert.strictEqual(stages[0].roles[0].name, "架构师");
  assert.strictEqual(stages[0].roles[1].name, "架构师-2");
  // review stage: developer(1) + reviewer(2) = 3 instances
  assert.strictEqual(stages[2].roles.length, 3);
});

// ── getSopTransitions ────────────────────────────────────────────────

console.log("\n  getSopTransitions()");

test("returns all transitions with generated IDs", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  const transitions = reader.getSopTransitions();
  assert.strictEqual(transitions.length, 3);
  assert.strictEqual(transitions[0].from_stage_key, "design");
  assert.strictEqual(transitions[0].to_stage_key, "development");
  assert.strictEqual(transitions[0].sop_id, "code-delivery");
  assert.strictEqual(transitions[2].guard?.type, "requires_artifacts");
});

// ── getForwardTransitions ────────────────────────────────────────────

console.log("\n  getForwardTransitions()");

test("returns forward edges from a stage", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  const fromDesign = reader.getForwardTransitions("design");
  assert.strictEqual(fromDesign.length, 1);
  assert.strictEqual(fromDesign[0].to_stage_key, "development");

  const fromReview = reader.getForwardTransitions("review");
  assert.strictEqual(fromReview.length, 1);
  assert.strictEqual(fromReview[0].to_stage_key, "development");
});

test("returns empty for terminal stage", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  const fromMerge = reader.getForwardTransitions("merge");
  assert.strictEqual(fromMerge.length, 0);
});

// ── validateTransition ───────────────────────────────────────────────

console.log("\n  validateTransition()");

test("returns edge for valid transition", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  const edge = reader.validateTransition("design", "development");
  assert.strictEqual(edge.from_stage_key, "design");
  assert.strictEqual(edge.to_stage_key, "development");
});

test("throws for invalid transition", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  assert.throws(() => reader.validateTransition("design", "merge"), /Invalid transition/);
});

// ── getStageDefinition ───────────────────────────────────────────────

console.log("\n  getStageDefinition()");

test("returns workspace stage definition with workspace_id", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  const sd = reader.getStageDefinition("sd-code-delivery-design", "ws-123");
  assert.ok(sd);
  assert.strictEqual(sd.workspace_id, "ws-123");
  assert.strictEqual(sd.key, "design");
});

test("returns empty workspace_id when not provided", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  const sd = reader.getStageDefinition("sd-code-delivery-design");
  assert.ok(sd);
  assert.strictEqual(sd.workspace_id, "");
});

test("returns undefined for mismatched sop_id prefix", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  assert.strictEqual(reader.getStageDefinition("sd-other-sop-design"), undefined);
});

// ── listRoleDefinitionsByStage ───────────────────────────────────────

console.log("\n  listRoleDefinitionsByStage()");

test("returns roles expanded by count", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  // design stage has designer with count=2
  const roles = reader.listRoleDefinitionsByStage("sd-code-delivery-design");
  assert.strictEqual(roles.length, 2);
  assert.strictEqual(roles[0].key, "designer");
  assert.strictEqual(roles[0].name, "架构师");
  assert.strictEqual(roles[0].is_primary, 1);
  assert.strictEqual(roles[1].name, "架构师-2");
  assert.strictEqual(roles[1].is_primary, 0);
});

test("returns roles with handbook content", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  const roles = reader.listRoleDefinitionsByStage("sd-code-delivery-design");
  assert.ok(roles[0].handbook?.includes("独立分析需求"));
});

test("returns empty for unknown stage", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  assert.deepStrictEqual(reader.listRoleDefinitionsByStage("sd-code-delivery-nonexistent"), []);
});

test("returns empty for mismatched prefix", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  assert.deepStrictEqual(reader.listRoleDefinitionsByStage("sd-other-sop-design"), []);
});

// ── collectSopRoleKeys ───────────────────────────────────────────────

console.log("\n  collectSopRoleKeys()");

test("returns all unique role keys", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  const keys = reader.collectSopRoleKeys();
  assert.ok(keys.has("designer"));
  assert.ok(keys.has("developer"));
  assert.ok(keys.has("reviewer"));
  assert.strictEqual(keys.size, 3);
});

// ── Guard handling ───────────────────────────────────────────────────

console.log("\n  Guard handling");

test("returns guard config for transition with guard", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  const edge = reader.validateTransition("review", "development");
  assert.ok(edge.guard);
  assert.strictEqual(edge.guard.type, "requires_artifacts");
  assert.deepStrictEqual(edge.guard.config.artifacts, ["fix_pr_url"]);
});

test("returns null guard for transition without guard", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  const edge = reader.validateTransition("design", "development");
  assert.strictEqual(edge.guard, null);
});

// ── Acceptance checklist ─────────────────────────────────────────────

console.log("\n  Acceptance checklist");

test("returns checklist items with required flag", () => {
  const reader = new SopSnapshotReader(FULL_SNAPSHOT);
  const sd = reader.getSopStageDefinitionByKey("design");
  assert.ok(sd);
  assert.strictEqual(sd.acceptance_checklist.length, 2);
  assert.strictEqual(sd.acceptance_checklist[0].id, "design-01");
  assert.strictEqual(sd.acceptance_checklist[0].required, true);
  assert.strictEqual(sd.acceptance_checklist[1].required, false);
});

// ── Summary ──────────────────────────────────────────────────────────

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
