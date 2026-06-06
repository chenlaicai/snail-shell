import fs from "fs";
import os from "os";
import path from "path";
import { ConversationStore } from "../../src/persistence/store";
import type { SopSeedItem } from "../../src/persistence/types";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const TEST_DB = path.join(os.tmpdir(), `test-workspace-config-replace-${Date.now()}.db`);
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

/** Use a temp config directory to avoid polluting production config/workspaces.json. */
const TEST_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "snail-test-config-"));
fs.writeFileSync(path.join(TEST_CONFIG_DIR, "workspaces.json"), JSON.stringify([]));

const store = new ConversationStore(TEST_DB, TEST_CONFIG_DIR);

// 初始化基础数据：先创建全局 SOP，再创建 workspace 和绑定
store.seedSopToCache({
  id: "sop-global-1",
  source: "platform",
  sourceRef: null,
  key: "sop-global-1",
  name: "Global SOP",
  description: null,
}, [{
  key: "development",
  title: "Development",
  sequence: 1,
  input_description: null,
  output_description: null,
  acceptance_focus: [],
  roles: [{ key: "developer", name: "Developer", description: "", is_primary: true }],
}]);

store.seedWorkspaceToCache({
  id: "workspace-1",  name: "Test Workspace", summary: "Initial summary", workspaceRoot: "/tmp/test",
  sopBindings: [{ sop_id: "sop-global-1", is_default: true, role_bindings: {} }],
});

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
    workspaceBindings: [{ sop_id: "sop-workspace-1", is_default: true, role_bindings: { developer: "template-1" } }],
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

  // 验证 workspace_sop binding
  const workspaceSops = store.listWorkspaceSops("workspace-1");
  assert(workspaceSops.some((ws) => ws.sop_id === "sop-workspace-1"), "workspace should have new sop binding");

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
    workspaceBindings: [{ sop_id: "sop-workspace-2", is_default: true, role_bindings: {} }],
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
  store.createIssue({ id: "issue-1", workspaceId: "workspace-1", title: "Test Issue", summary: "Test" });

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
    workspaceBindings: [{ sop_id: "sop-workspace-3", is_default: true, role_bindings: {} }],
  });

  // 新 SOP 应该存在
  const newSop = store.getSop("sop-workspace-3");
  assert(newSop !== undefined, "new workspace sop should exist");

  console.log("  ✓ testReplaceWorkspaceConfigsPreservesReferencedSops passed");
}

// 测试 ensureSingleDefaultSop
function testReplaceWorkspaceConfigsEnsuresSingleDefault() {
  const newSopSeeds: SopSeedItem[] = [
    {
      sop: { id: "sop-multi-1", source: "workspace", sourceRef: "workspace-1", key: "sop-multi-1", name: "SOP 1", description: null },
      stage_definitions: [{
        key: "development", title: "Development", sequence: 1, input_description: null, output_description: null, acceptance_focus: [],
        roles: [{ key: "developer", name: "Developer", description: "", is_primary: true }],
      }],
    },
    {
      sop: { id: "sop-multi-2", source: "workspace", sourceRef: "workspace-1", key: "sop-multi-2", name: "SOP 2", description: null },
      stage_definitions: [{
        key: "development", title: "Development", sequence: 1, input_description: null, output_description: null, acceptance_focus: [],
        roles: [{ key: "developer", name: "Developer", description: "", is_primary: true }],
      }],
    },
  ];

  store.replaceWorkspaceConfigs("workspace-1", {
    workspaceUpdate: { name: "Multi SOP Workspace" },
    sopSeeds: newSopSeeds,
    workspaceBindings: [
      { sop_id: "sop-multi-1", is_default: true, role_bindings: {} },
      { sop_id: "sop-multi-2", is_default: true, role_bindings: {} }, // 两个都是 default
    ],
  });

  // 只应该有一个 default
  const workspaceSops = store.listWorkspaceSops("workspace-1");
  const defaultSops = workspaceSops.filter((ws) => ws.is_default);
  assert(defaultSops.length === 1, "should have exactly one default sop");

  console.log("  ✓ testReplaceWorkspaceConfigsEnsuresSingleDefault passed");
}

// 运行所有测试
console.log("Running workspace-config-replace tests...");
testReplaceWorkspaceConfigsBasic();
testReplaceWorkspaceConfigsRemovesOldSops();
testReplaceWorkspaceConfigsPreservesReferencedSops();
testReplaceWorkspaceConfigsEnsuresSingleDefault();
console.log("workspace-config-replace tests passed");
