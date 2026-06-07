import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";

/** 测试专用临时工作区根目录，避免 createWorkspace 写 .snail/init.json 污染项目目录 */
const TEST_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "snail-test-ws-api-"));
import { createServer } from "../../src/interaction-entry/api/server";
import { WorkspaceManager } from "../../src/workspace-workflow/manager";
import { ConversationStore } from "../../src/persistence/store";
import type { SnailRuntime } from "../../src/agent/interface";
import { SnailDen, type SystemAI } from "../../src/snail-den";

const configPath = path.resolve(process.cwd(), "config/snail-den.json");
const backupPath = `${configPath}.workspace-api-test-backup`;
const hadConfig = fs.existsSync(configPath);
if (hadConfig) fs.renameSync(configPath, backupPath);
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify({ snails: [{ id: "template-valid", name: "Valid Template", runtime: "opencode-cli", model: "test-model" }] }));

/** Use a temp config directory to avoid polluting production config/workspaces.json. */
const DATA_DIR = path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const TEST_CONFIG_DIR = fs.mkdtempSync(path.join(DATA_DIR, "test-config-ws-api-"));
fs.writeFileSync(path.join(TEST_CONFIG_DIR, "workspaces.json"), JSON.stringify([]));

const store = new ConversationStore(":memory:", TEST_CONFIG_DIR);

/* 直接在数据库中创建测试 SOP（模拟从 YAML 加载） */
store.seedSopToCache({ id: "test-sop", source: "platform", source_ref: null, key: "test-sop", name: "Test SOP", description: null }, [
  { key: "design", title: "需求对齐与设计", sequence: 1, roles: [{ key: "designer", name: "架构师", description: "designer", is_primary: true }] },
  { key: "development", title: "研发实现", sequence: 2, roles: [{ key: "developer", name: "开发者", description: "dev", is_primary: true }] },
  { key: "review", title: "PR 检视", sequence: 3, roles: [{ key: "developer", name: "开发者", description: "dev", is_primary: true }, { key: "reviewer", name: "审查者", description: "rev" }] },
  { key: "merge", title: "合入", sequence: 4, roles: [{ key: "merger", name: "维护者", description: "merger", is_primary: true }] },
]);

store.seedSopToCache({ id: "dev-only", source: "platform", source_ref: null, key: "dev-only", name: "Dev Only SOP", description: null }, [
  { key: "development", title: "执行", sequence: 1, roles: [{ key: "executor", name: "执行者", description: "exec", is_primary: true }] },
]);

const runtime: SnailRuntime = { name: "test", runtime: "opencode-cli", invokeMessage: async () => ({}) };
const snailDen = new SnailDen({ resolve: () => runtime, list: () => [runtime] });
const systemAI: SystemAI = {
  generateConversationSummary: async () => "summary",
  generateMessageContextSummary: async () => "summary",
  extractMentions: async () => ({ mentions: [] }),
};
const manager = new WorkspaceManager(store, { resolve: () => runtime, list: () => [runtime] }, { snailDen, systemAI });
const { server } = createServer(manager, snailDen, store);

function listen(): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("server address was not available"));
      else resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function postWorkspace(baseUrl: string, overrides: Record<string, unknown> = {}): Promise<{ status: number; body: any }> {
  const payload = JSON.stringify({
    name: `Workspace ${Date.now()}`,
    summary: "test",
    workspace_root: TEST_WORKSPACE_ROOT,
    sop_id: "test-sop",
    role_snail_mapping: { design: { designer: "template-valid" }, development: { developer: "template-valid" }, review: { developer: "template-valid", reviewer: "template-valid" }, merge: { merger: "template-valid" } },
    ...overrides,
  });
  const response = await fetch(`${baseUrl}/api/workspaces`, { method: "POST", headers: { "content-type": "application/json" }, body: payload });
  return { status: response.status, body: await response.json() };
}

(async () => {
  const baseUrl = await listen();

  const created = await postWorkspace(baseUrl);
  assert.equal(created.status, 201, `expected 201 but got ${created.status}: ${JSON.stringify(created.body)}`);
  const workspaceDetail = manager.getWorkspace(created.body.workspace.id);
  assert(workspaceDetail);
  const stage = workspaceDetail.issues[0].stages[0];
  assert(stage);
  // snail_template_id is null in snapshots — template binding is applied at runtime via role_bindings
  assert.equal(stage.role_definitions[0].snail_template_id, null);

  const missingSopId = await postWorkspace(baseUrl, { sop_id: undefined });
  assert.equal(missingSopId.status, 400, "sop_id should be required");

  const nonExistentSop = await postWorkspace(baseUrl, { sop_id: "sop-nonexistent" });
  assert.equal(nonExistentSop.status, 400);

  const sopDevOnly = await postWorkspace(baseUrl, { sop_id: "dev-only", role_snail_mapping: { development: { executor: "template-valid" } } });
  assert.equal(sopDevOnly.status, 201, `SOP with single stage (no transitions) should be accepted: ${JSON.stringify(sopDevOnly.body)}`);
  assert.equal(sopDevOnly.body.stage.type, "development", "single-stage SOP should start at its only stage");

  console.log("workspace api tests passed");
})().finally(() => {
  server.close();
  fs.rmSync(configPath, { force: true });
  if (hadConfig) fs.renameSync(backupPath, configPath);
});
