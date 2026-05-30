import assert from "assert";
import fs from "fs";
import path from "path";
import { createServer } from "../../src/interaction-entry/api/server";
import { WorkspaceManager } from "../../src/workspace-workflow/manager";
import { ConversationStore } from "../../src/persistence/store";
import { RoleRegistry } from "../../src/roles";
import type { SnailRuntime } from "../../src/agent/interface";
import { SnailDen, type SystemAI } from "../../src/snail-den";
import type { WorkspaceConfigSeed } from "../../src/persistence/workspace-config-model";

const configPath = path.resolve(process.cwd(), "config/snail-den.json");
const backupPath = `${configPath}.evolution-center-test-backup`;
const hadConfig = fs.existsSync(configPath);
if (hadConfig) fs.renameSync(configPath, backupPath);
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify({ snails: [{ id: "codex-gpt-5-5", name: "Codex GPT-5.5", runtime: "codex-cli", model: "gpt-5.5" }] }));

const store = new ConversationStore(":memory:");

const SEED: WorkspaceConfigSeed = {
  sops: [
    {
      sop: { id: "sop-evolution", scope: "global", key: "evolution", name: "演进治理流程", description: "演进工作区治理。" },
      role_definitions: [
        { id: "role-evolution-boss", key: "boss", name: "Boss Role", description: "演进治理对话的决策者。" },
        { id: "role-evolution-executor", key: "evolution-executor", name: "演进执行者", description: "负责演进工作区的治理对话。", handbook_prompt_ref: "global:S-08", working_rules: ["逐条分析演进工作区的内容、来源和作用域"] },
      ],
      stage_definitions: [
        { id: "evolution-center-development", key: "development", title: "演进治理", sequence: 1, output_description: "完成演进工作区治理。", acceptance_focus: ["演进工作区来源和事实被查证"], roles: [{ role_key: "boss", is_primary: true }, { role_key: "evolution-executor" }] },
      ],
    },
  ],
  workspaces: [
    {
      workspace: { id: "evolution-center", module: "evolution", name: "Evolution Center", summary: "Snail Shell 演进中心治理空间。", workspace_root: process.cwd() },
      sops: [{ sop_id: "sop-evolution", is_default: true, role_bindings: { "evolution-executor": "codex-gpt-5-5" } }],
    },
  ],
};
store.seedWorkspaceConfigs(SEED);

const roleRegistry = new RoleRegistry(store);
const runtime: SnailRuntime = { name: "test", runtime: "codex-cli", invokeMessage: async () => ({}) };
const snailDen = new SnailDen({ resolve: () => runtime, list: () => [runtime] });
const systemAI: SystemAI = {
  generateConversationSummary: async () => "summary",
  generateMessageContextSummary: async () => "summary",
  extractMentions: async () => ({ mentions: [] }),
};
const manager = new WorkspaceManager(store, { resolve: () => runtime, list: () => [runtime] }, { roleRegistry, snailDen, systemAI }, { defaultSopKey: "evolution" });
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

async function createItem(baseUrl: string, overrides: Record<string, unknown> = {}): Promise<{ status: number; body: any }> {
  const payload = JSON.stringify({
    workspace_id: "evolution-center",
    title: `演进工作区 ${Date.now()}`,
    content: "测试演进工作区内容",
    tags: ["test"],
    ...overrides,
  });
  const response = await fetch(`${baseUrl}/api/evolution/items`, { method: "POST", headers: { "content-type": "application/json" }, body: payload });
  return { status: response.status, body: await response.json() as any };
}

(async () => {
  const baseUrl = await listen();

  // ── Create ─────────────────────────────────────────────────────────
  const created = await createItem(baseUrl);
  assert.equal(created.status, 201, `expected 201 but got ${created.status}: ${JSON.stringify(created.body)}`);
  assert(created.body.id, "created item should have id");
  assert.equal(created.body.workspace_id, "evolution-center", "created item should have correct workspace_id");
  assert(created.body.title, "created item should have title");
  assert(created.body.content, "created item should have content");
  assert(Array.isArray(created.body.tags), "created item should have tags array");
  assert(created.body.created_at, "created item should have created_at");
  assert(created.body.updated_at, "created item should have updated_at");
  // 演进工作区创建时应自动生成 Feature 和 Conversation
  assert(created.body.feature_id, "created item should have auto-generated feature_id");
  assert(created.body.conversation, "created item should have auto-generated conversation");
  assert(created.body.conversation.owner_type === "evolution", "conversation should be evolution type");

  // ── Get by ID ──────────────────────────────────────────────────────
  const fetched = await fetch(`${baseUrl}/api/evolution/items/${created.body.id}`);
  assert.equal(fetched.status, 200, "GET /evolution/items/:id should return 200");
  const fetchedBody = await fetched.json() as any;
  assert.equal(fetchedBody.id, created.body.id, "fetched item should match created item");
  assert.equal(fetchedBody.title, created.body.title, "fetched title should match");

  // ── Get 404 ────────────────────────────────────────────────────────
  const notFound = await fetch(`${baseUrl}/api/evolution/items/nonexistent`);
  assert.equal(notFound.status, 404, "GET nonexistent item should return 404");

  // ── List ───────────────────────────────────────────────────────────
  const listed = await fetch(`${baseUrl}/api/evolution/items`);
  assert.equal(listed.status, 200, "GET /evolution/items should return 200");
  const listedBody = await listed.json() as any;
  assert(Array.isArray(listedBody), "list should return array");
  assert(listedBody.length >= 1, "list should contain at least one item");
  assert(listedBody.some((item: any) => item.id === created.body.id), "list should include created item");

  // ── List by workspace ────────────────────────────────────────────────
  const listedByWorkspace = await fetch(`${baseUrl}/api/workspaces/evolution-center/evolution/items`);
  assert.equal(listedByWorkspace.status, 200, "GET /workspaces/:id/evolution/items should return 200");
  const listedByWorkspaceBody = await listedByWorkspace.json() as any;
  assert(Array.isArray(listedByWorkspaceBody), "workspace list should return array");
  assert(listedByWorkspaceBody.every((item: any) => item.workspace_id === "evolution-center"), "all items should belong to workspace");

  // ── List with FTS query ────────────────────────────────────────────
  const searched = await fetch(`${baseUrl}/api/evolution/items?query=${encodeURIComponent("测试演进工作区内容")}`);
  assert.equal(searched.status, 200, "GET /evolution/items with query should return 200");
  const searchedBody = await searched.json() as any;
  assert(searchedBody.some((item: any) => item.id === created.body.id), "FTS search should find the created item");

  // ── Update ─────────────────────────────────────────────────────────
  const updated = await fetch(`${baseUrl}/api/evolution/items/${created.body.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "演进工作区标题已更新", tags: ["test", "updated"] }),
  });
  assert.equal(updated.status, 200, "PATCH /evolution/items/:id should return 200");
  const updatedBody = await updated.json() as any;
  assert.equal(updatedBody.title, "演进工作区标题已更新", "updated title should match");
  assert(updatedBody.tags.includes("updated"), "updated tags should include new tag");

  // ── Create validation: missing title ───────────────────────────────
  const missingTitle = await createItem(baseUrl, { title: undefined });
  assert.equal(missingTitle.status, 400, "missing title should return 400");
  assert(missingTitle.body.error.includes("title"), "error should mention title");

  // ── Create validation: missing content ─────────────────────────────
  const missingContent = await createItem(baseUrl, { content: undefined });
  assert.equal(missingContent.status, 400, "missing content should return 400");
  assert(missingContent.body.error.includes("content"), "error should mention content");

  // ── Create validation: missing workspace_id ──────────────────────────
  const missingWorkspace = await createItem(baseUrl, { workspace_id: undefined });
  assert.equal(missingWorkspace.status, 400, "missing workspace_id should return 400");
  assert(missingWorkspace.body.error.includes("workspace_id"), "error should mention workspace_id");

  // ── Verify DB state: evolution_item table works ────────────────────
  const dbItem = store.getEvolutionItem(created.body.id);
  assert(dbItem, "store.getEvolutionItem should return the item");
  assert.equal(dbItem!.title, "演进工作区标题已更新", "store should reflect updated title");
  assert(dbItem!.feature_id, "store item should have feature_id");

  // ── Verify DB state: list by workspace ───────────────────────────────
  const storeList = store.listEvolutionItems({ workspaceId: "evolution-center" });
  assert(storeList.length >= 1, "store.listEvolutionItems should return items");
  assert(storeList.some((item) => item.id === created.body.id), "store list should include created item");

  console.log("evolution center tests passed");
})().finally(() => {
  server.close();
  fs.rmSync(configPath, { force: true });
  if (hadConfig) fs.renameSync(backupPath, configPath);
});
