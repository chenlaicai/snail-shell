import assert from "assert";
import fs from "fs";
import path from "path";
import { createServer } from "../../src/interaction-entry/api/server";
import { ProjectManager } from "../../src/project-workflow/manager";
import { ConversationStore } from "../../src/persistence/store";
import { RoleRegistry } from "../../src/snails";
import type { SnailRuntime } from "../../src/agent/interface";
import { SnailDen, type SystemAI } from "../../src/snail-den";

const configPath = path.resolve(process.cwd(), "config/snail-den.json");
const backupPath = `${configPath}.project-api-test-backup`;
const hadConfig = fs.existsSync(configPath);
if (hadConfig) fs.renameSync(configPath, backupPath);
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify({ snails: [{ id: "template-valid", name: "Valid Template", runtime: "opencode-cli", model: "test-model" }] }));

const store = new ConversationStore(":memory:");
const roleRegistry = new RoleRegistry(store);
const runtime: SnailRuntime = { name: "test", runtime: "opencode-cli", invokeMessage: async () => ({}) };
const snailDen = new SnailDen({ resolve: () => runtime, list: () => [runtime] });
const systemAI: SystemAI = {
  generateConversationSummary: async () => "summary",
  generateMessageContextSummary: async () => "summary",
  extractMentions: async () => ({ mentions: [] }),
};
const manager = new ProjectManager(store, { resolve: () => runtime, list: () => [runtime] }, { roleRegistry, snailDen, systemAI });
const { server } = createServer(manager, snailDen);

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

async function postProject(baseUrl: string, stageTemplateId: string): Promise<{ status: number; body: any }> {
  const payload = JSON.stringify({
    name: `Project ${stageTemplateId}`,
    summary: "test",
    kind: "product_delivery",
    stage_definitions: [{ key: "development", title: "研发迭代", sequence: 1, roles: [{ name: "研发者", snail_template_id: stageTemplateId, is_primary: true }] }],
  });
  const response = await fetch(`${baseUrl}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: payload });
  return { status: response.status, body: await response.json() };
}

(async () => {
  const baseUrl = await listen();
  const created = await postProject(baseUrl, "template-valid");
  assert.equal(created.status, 201);
  const stage = manager.getProject(created.body.project.id)?.features[0].stages[0];
  assert(stage);
  assert.equal(stage.role_definitions[0].snail_template_id, "template-valid");

  const rejected = await postProject(baseUrl, "role-definition-id");
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, "Snail Den 中未找到 template: role-definition-id");

  console.log("project api tests passed");
})().finally(() => {
  server.close();
  fs.rmSync(configPath, { force: true });
  if (hadConfig) fs.renameSync(backupPath, configPath);
});
