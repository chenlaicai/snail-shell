import assert from "assert";
import fs from "fs";
import path from "path";
import { createServer } from "../../src/interaction-entry/api/server";
import { ProjectManager } from "../../src/project-workflow/manager";
import { ConversationStore } from "../../src/persistence/store";
import { RoleRegistry } from "../../src/roles";
import type { SnailRuntime } from "../../src/agent/interface";
import { SnailDen, type SystemAI } from "../../src/snail-den";
import type { ProjectConfigSeed } from "../../src/persistence/project-config-model";

const configPath = path.resolve(process.cwd(), "config/snail-den.json");
const backupPath = `${configPath}.project-api-test-backup`;
const hadConfig = fs.existsSync(configPath);
if (hadConfig) fs.renameSync(configPath, backupPath);
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify({ snails: [{ id: "template-valid", name: "Valid Template", runtime: "opencode-cli", model: "test-model" }] }));

const store = new ConversationStore(":memory:");

const SEED: ProjectConfigSeed = {
  sops: [
    {
      sop: { id: "sop-test", scope: "global", key: "test-sop", name: "Test SOP" },
      role_definitions: [
        { id: "role-test-dev", key: "developer", name: "研发者", description: "dev" },
        { id: "role-test-rev", key: "reviewer", name: "检视者", description: "rev" },
      ],
      stage_definitions: [
        { id: "stage-test-dev", key: "development", title: "研发迭代", sequence: 1, roles: [{ role_key: "developer", is_primary: true }] },
        { id: "stage-test-rev", key: "review", title: "PR 检视", sequence: 2, roles: [{ role_key: "developer", is_primary: true }, { role_key: "reviewer" }] },
      ],
    },
    {
      sop: { id: "sop-dev-only", scope: "global", key: "dev-only", name: "Dev Only SOP" },
      role_definitions: [
        { id: "role-dev-only", key: "executor", name: "执行者", description: "exec" },
      ],
      stage_definitions: [
        { id: "stage-dev-only", key: "development", title: "执行", sequence: 1, roles: [{ role_key: "executor", is_primary: true }] },
      ],
    },
  ],
  projects: [],
};
store.seedProjectConfigs(SEED);

const roleRegistry = new RoleRegistry(store);
const runtime: SnailRuntime = { name: "test", runtime: "opencode-cli", invokeMessage: async () => ({}) };
const snailDen = new SnailDen({ resolve: () => runtime, list: () => [runtime] });
const systemAI: SystemAI = {
  generateConversationSummary: async () => "summary",
  generateMessageContextSummary: async () => "summary",
  extractMentions: async () => ({ mentions: [] }),
};
const manager = new ProjectManager(store, { resolve: () => runtime, list: () => [runtime] }, { roleRegistry, snailDen, systemAI }, { defaultSopKey: "test-sop" });
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

async function postProject(baseUrl: string, overrides: Record<string, unknown> = {}): Promise<{ status: number; body: any }> {
  const payload = JSON.stringify({
    name: `Project ${Date.now()}`,
    summary: "test",
    project_root: process.cwd(),
    role_bindings: { developer: "template-valid", reviewer: "template-valid" },
    ...overrides,
  });
  const response = await fetch(`${baseUrl}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: payload });
  return { status: response.status, body: await response.json() };
}

(async () => {
  const baseUrl = await listen();

  const created = await postProject(baseUrl);
  assert.equal(created.status, 201, `expected 201 but got ${created.status}: ${JSON.stringify(created.body)}`);
  const projectDetail = manager.getProject(created.body.project.id);
  assert(projectDetail);
  const stage = projectDetail.features[0].stages[0];
  assert(stage);
  assert.equal(stage.role_definitions[0].snail_template_id, "template-valid");

  const withExplicitSop = await postProject(baseUrl, { sop_id: "sop-test" });
  assert.equal(withExplicitSop.status, 201);

  const missingRoleBindings = await postProject(baseUrl, { role_bindings: undefined });
  assert.equal(missingRoleBindings.status, 400);

  const nonExistentSop = await postProject(baseUrl, { sop_id: "sop-nonexistent" });
  assert.equal(nonExistentSop.status, 400);

  const sopMissingReviewStage = await postProject(baseUrl, { sop_id: "sop-dev-only", role_bindings: { executor: "template-valid" } });
  assert.equal(sopMissingReviewStage.status, 400, `SOP without review stage should be rejected: ${JSON.stringify(sopMissingReviewStage.body)}`);
  assert(sopMissingReviewStage.body.error.includes("review"), "error should mention missing review stage");

  const invalidTemplate = await postProject(baseUrl, { role_bindings: { developer: "nonexistent-template", reviewer: "template-valid" } });
  assert.equal(invalidTemplate.status, 400, `invalid template ID should be rejected: ${JSON.stringify(invalidTemplate.body)}`);
  assert(invalidTemplate.body.error.includes("nonexistent-template"), "error should mention the invalid template");

  const unknownRoleKey = await postProject(baseUrl, { role_bindings: { bogus: "template-valid" } });
  assert.equal(unknownRoleKey.status, 400, `unknown role key should be rejected: ${JSON.stringify(unknownRoleKey.body)}`);
  assert(unknownRoleKey.body.error.includes("bogus"), "error should mention the unknown role key");

  const incompleteBindings = await postProject(baseUrl, { role_bindings: { developer: "template-valid" } });
  assert.equal(incompleteBindings.status, 400, `incomplete bindings should be rejected: ${JSON.stringify(incompleteBindings.body)}`);
  assert(incompleteBindings.body.error.includes("reviewer"), "error should mention the missing role");

  console.log("project api tests passed");
})().finally(() => {
  server.close();
  fs.rmSync(configPath, { force: true });
  if (hadConfig) fs.renameSync(backupPath, configPath);
});
