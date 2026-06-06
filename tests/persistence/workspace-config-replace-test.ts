import fs from "fs";
import path from "path";
import { ConversationStore } from "../../src/persistence/store";
import type { SopSeedItem } from "../../src/persistence/types";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-store.db");
fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

/** Use a temp config directory to avoid polluting production config/workspaces.json. */
const TEST_CONFIG_DIR = path.join(__dirname, "..", "..", "data", "test-config-persistence");
fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
fs.writeFileSync(path.join(TEST_CONFIG_DIR, "workspaces.json"), JSON.stringify([]));

const store = new ConversationStore(TEST_DB, TEST_CONFIG_DIR);

/* 直接在数据库中创建测试 SOP（模拟从 YAML 加载） */
store.seedSopToCache({ id: "workspace-1-sop", source: "platform", sourceRef: null, key: "workspace-1-sop", name: "Workspace 1 SOP", description: null }, [
  { key: "development", title: "研发迭代", sequence: 1, input_description: null, output_description: "交付 PR", acceptance_focus: [], roles: [{ key: "developer", name: "开发者", description: "", is_primary: true, handbook: "" }] },
  { key: "review", title: "PR 检视", sequence: 2, input_description: "上一阶段产出", output_description: "检视完成", acceptance_focus: [], roles: [{ key: "reviewer", name: "审查者", description: "", is_primary: true, handbook: "" }] },
]);

store.seedSopToCache({ id: "evolution", source: "platform", sourceRef: null, key: "evolution", name: "Evolution Center SOP", description: null }, [
  { key: "development", title: "演进治理", sequence: 1, input_description: null, output_description: "完成演进工作区治理", acceptance_focus: [], roles: [{ key: "executor", name: "演进执行者", description: "负责执行演进治理流程：入口校验、查重、裁决去向跟踪", is_primary: true, handbook: "## 工作规则\n\n- 严格按入口校验流程\n- 查重需覆盖全局演进工作区库\n- 裁决去向必须明确并记录PR链接" }] },
]);

/* ── count 展开测试 ──────────────────────────────────────────────── */
store.seedSopToCache({ id: "count-test-sop", source: "platform", sourceRef: null, key: "count-test-sop", name: "Count Test SOP", description: null }, [
  { key: "development", title: "研发迭代", sequence: 1, input_description: null, output_description: "交付", acceptance_focus: [], roles: [
    { key: "developer", name: "开发者", description: "", is_primary: true, handbook: "" },
    { key: "reviewer", name: "审查者", description: "", is_primary: false, handbook: "", count: 2 },
  ] },
]);

const countTestStages = store.listSopStageDefinitions("count-test-sop");
assert(countTestStages.length === 1, "count-test should have 1 stage");
const countTestRoles = store.listSopStageRoleDefinitions(countTestStages[0].id);
assert(countTestRoles.length === 3, `count-test stage should have 3 role rows (1 developer + 2 reviewers), got ${countTestRoles.length}`);
const reviewerInstances = countTestRoles.filter((r) => r.key === "reviewer");
assert(reviewerInstances.length === 2, `should have 2 reviewer instances, got ${reviewerInstances.length}`);
assert(reviewerInstances[0].name === "审查者-1", `first reviewer name should be "审查者-1", got "${reviewerInstances[0].name}"`);
assert(reviewerInstances[1].name === "审查者-2", `second reviewer name should be "审查者-2", got "${reviewerInstances[1].name}"`);
assert(reviewerInstances[0].id === "srd-development-reviewer-1", `first reviewer id unexpected: "${reviewerInstances[0].id}"`);
assert(reviewerInstances[1].id === "srd-development-reviewer-2", `second reviewer id unexpected: "${reviewerInstances[1].id}"`);
assert(reviewerInstances[0].count === 2, "count field should be 2 on expanded instances");
const developerInstances = countTestRoles.filter((r) => r.key === "developer");
assert(developerInstances[0].name === "开发者", `developer name should not be expanded, got "${developerInstances[0].name}"`);
assert(developerInstances[0].count === 1, "developer count should be 1");

/* Seed workspace */
store.seedWorkspaceToCache({
  id: "count-test-ws",  name: "Count Test", summary: "", workspaceRoot: process.cwd(),
});
store.seedWorkspaceToCache({
  id: "workspace-1", name: "Snail Shell", summary: "Self evolution", workspaceRoot: process.cwd(),
});

const workspace = store.getWorkspace("workspace-1")!;
const issue = store.createIssue({ id: "issue-1", workspaceId: workspace.id, title: "Issue", summary: "Self evolution" });
const stage = store.createStage({ id: "stage-1", workspaceId: workspace.id, issueId: issue.id, stageDefinitionId: "development", type: "development", sequence: 1, status: "in_progress", enteredAt: new Date().toISOString() });
store.createConversation({ id: "conversation-1", workspaceId: workspace.id, issueId: issue.id, stageId: stage.id, title: "Founding discussion", kind: "discussion", defaultRole: "Owner Snail", participatingRoles: ["项目负责人", "Owner Snail", "Product Snail"], summary: "Initial discussion", fromConversationIds: [] });

// 测试 replaceWorkspaceConfigs 基本功能
function testReplaceWorkspaceConfigsBasic() {
  const newSopSeeds: SopSeedItem[] = [{
    sop: { id: "sop-workspace-1", source: "workspace", sourceRef: "workspace-1", key: "sop-workspace-1", name: "Workspace SOP", description: "Test SOP" },
    stage_definitions: [
      {
        key: "development", title: "Development", sequence: 1, input_description: "input", output_description: "output", acceptance_focus: ["focus1"],
        roles: [{ key: "developer", name: "Developer", description: "Dev role", handbook: "## 工作规则\n\n- rule1", is_primary: true }],
      },
      {
        key: "review", title: "Review", sequence: 2, input_description: null, output_description: null, acceptance_focus: [],
        roles: [{ key: "reviewer", name: "Reviewer", description: "Review role", handbook: "## 工作规则\n\n- rule2", is_primary: true }],
      },
    ],
  }];

  store.replaceWorkspaceConfigs("workspace-1", {
    workspaceUpdate: { name: "Updated Workspace", summary: "Updated summary" },
    sopSeeds: newSopSeeds,
  });

  // 验证 workspace 更新
  const workspace = store.getWorkspace("workspace-1");
  assert(workspace?.name === "Updated Workspace", "workspace name should be updated");
  assert(workspace?.summary === "Updated summary", "workspace summary should be updated");

  // 验证 SOP 已创建
  const sop = store.getSop("sop-workspace-1");
  assert(sop !== undefined, "workspace sop should exist");
  assert(sop?.key === "sop-workspace-1", "sop key should match");

  // 验证 stage_definitions
  const stageDefs = store.listSopStageDefinitions("sop-workspace-1");
  assert(stageDefs.length === 2, "should have 2 stage definitions");
  assert(stageDefs.some((s) => s.key === "development"), "should have development stage");
  assert(stageDefs.some((s) => s.key === "review"), "should have review stage");

  // 验证 stage_role_definition（角色现在嵌套在 stage 下）
  const stagesWithRoles = store.listSopStageDefinitionsWithRoles("sop-workspace-1");
  const allRoles = stagesWithRoles.flatMap((s) => s.roles);
  assert(allRoles.length === 2, "should have 2 role definitions across all stages");
  assert(allRoles.some((r) => r.key === "developer"), "should have developer role");
  assert(allRoles.some((r) => r.key === "reviewer"), "should have reviewer role");

  console.log("  ✓ testReplaceWorkspaceConfigsBasic passed");
}

// 测试全量替换：旧 SOP 被移除
function testReplaceWorkspaceConfigsRemovesOldSops() {
  const newSopSeeds: SopSeedItem[] = [{
    sop: { id: "sop-workspace-2", source: "workspace", sourceRef: "workspace-1", key: "sop-workspace-2", name: "New SOP", description: null },
    stage_definitions: [
      {
        key: "development", title: "Development", sequence: 1, input_description: null, output_description: null, acceptance_focus: [],
        roles: [{ key: "developer", name: "Developer", description: "", is_primary: true }],
      },
    ],
  }];

  store.replaceWorkspaceConfigs("workspace-1", {
    workspaceUpdate: { name: "Workspace After Replace" },
    sopSeeds: newSopSeeds,
  });

  // 旧 SOP 文件仍保留在磁盘上（replaceWorkspaceConfigs 只替换绑定，不删除 SOP 文件）
  const oldSop = store.getSop("sop-workspace-1");
  assert(oldSop !== undefined, "old workspace sop file should still exist on disk");

  // 新 SOP 应该存在
  const newSop = store.getSop("sop-workspace-2");
  assert(newSop !== undefined, "new workspace sop should exist");

  console.log("  ✓ testReplaceWorkspaceConfigsRemovesOldSops passed");
}

// 测试保留被 issue 引用的 SOP
function testReplaceWorkspaceConfigsPreservesReferencedSops() {
  // 先创建一个使用 sop-global-1 的 issue
  store.createIssue({ id: "issue-2", workspaceId: "workspace-1", title: "Test Issue", summary: "Test" });

  // 尝试替换配置，但 sop-global-1 是全局 SOP，不会被删除
  const newSopSeeds: SopSeedItem[] = [{
    sop: { id: "sop-workspace-3", source: "workspace", sourceRef: "workspace-1", key: "sop-workspace-3", name: "Another SOP", description: null },
    stage_definitions: [
      {
        key: "development", title: "Development", sequence: 1, input_description: null, output_description: null, acceptance_focus: [],
        roles: [{ key: "developer", name: "Developer", description: "", is_primary: true }],
      },
    ],
  }];

  store.replaceWorkspaceConfigs("workspace-1", {
    workspaceUpdate: { name: "Workspace With Issue" },
    sopSeeds: newSopSeeds,
  });

  // 新 SOP 应该存在
  const newSop = store.getSop("sop-workspace-3");
  assert(newSop !== undefined, "new workspace sop should exist");

  console.log("  ✓ testReplaceWorkspaceConfigsPreservesReferencedSops passed");
}

// 运行所有测试
console.log("Running workspace-config-replace tests...");
testReplaceWorkspaceConfigsBasic();
testReplaceWorkspaceConfigsRemovesOldSops();
testReplaceWorkspaceConfigsPreservesReferencedSops();
console.log("workspace-config-replace tests passed");
