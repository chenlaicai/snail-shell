import assert from "assert";
import fs from "fs";
import http from "http";
import path from "path";
import express from "express";
import { ConversationStore } from "../../src/persistence/store";
import { registerMcpEndpoint } from "../../src/mcp/endpoint";

/** Use a temp config directory to avoid polluting production config/sop/. */
const TEST_CONFIG_DIR = path.join(__dirname, "..", "..", "data", "test-config-mcp-endpoint");
fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
fs.writeFileSync(path.join(TEST_CONFIG_DIR, "workspaces.json"), JSON.stringify({ workspaces: [] }));

function postJson(app: express.Express, body: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") { server.close(); reject(new Error("bad address")); return; }
      const port = typeof addr === "object" ? addr.port : 0;
      const req = http.request({ hostname: "127.0.0.1", port, path: "/snail-final-response", method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
        let data = "";
        res.on("data", (chunk: string) => { data += chunk; });
        res.on("end", () => { server.close(); resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null }); });
      });
      req.on("error", (err) => { server.close(); reject(err); });
      req.write(JSON.stringify(body));
      req.end();
    });
  });
}

// 使用已有的 snail-shell 工作区和 SOP 创建合法的 message 实例
function createMessage(store: ConversationStore): { convId: string; msgId: number } {
  /* 直接在 FileConfigStore 缓存中创建测试 SOP 和 workspace（模拟从 YAML 加载）。
     seedSopToCache 会写入 YAML 文件；若文件已存在（同一进程内多次调用），跳过创建。 */
  store.seedSopToCache(
    { id: "mcp-e2e-sop", source: "platform", sourceRef: null, key: "mcp-e2e-sop", name: "MCP E2E SOP", description: null },
    [{ key: "dev", title: "Dev", sequence: 1, roles: [{ key: "user", name: "用户", is_primary: true }] }],
  );
  store.seedWorkspaceToCache({
    id: "mcp-e2e", name: "MCP E2E", summary: "", workspaceRoot: process.cwd(),
    sopBindings: [{ sop_id: "mcp-e2e-sop", is_default: true, role_bindings: { user: "opencode-default" } }],
  });
  const issue = store.createIssue({ id: "mcp-e2e-i", workspaceId: "mcp-e2e", title: "MCP E2E Issue" })!;
  const sd = store.getStageDefinitionByKey("mcp-e2e", "dev")!;
  const stage = store.createStage({ id: "mcp-e2e-stage", workspaceId: "mcp-e2e", issueId: issue.id, stageDefinitionId: sd.id, type: "development", sequence: 1, title: "Dev", status: "active" } as any)!;
  const conv = store.createConversation({ id: "mcp-e2e-conv", workspaceId: "mcp-e2e", issueId: issue.id, stageId: stage.id, title: "E2E Conv", kind: "discussion", defaultRole: "用户", participatingRoles: [] } as any)!;
  const msg = store.addMessage({ conversationId: conv.id, fromRole: "项目负责人", toRoles: ["开发者"], role: "assistant", runtime: "claude-code-cli" as any, status: "streaming" });
  return { convId: conv.id, msgId: msg.id };
}

function testInitialize(): Promise<void> {
  const app = express(); app.use(express.json());
  registerMcpEndpoint(app, new ConversationStore(":memory:", TEST_CONFIG_DIR));
  return postJson(app, { jsonrpc: "2.0", id: 1, method: "initialize" }).then((r: any) => {
    assert.ok(r.data?.result?.serverInfo, "should return serverInfo");
    assert.equal(r.data?.result?.serverInfo?.name, "snail-final-response", "server name should be snail-final-response");
    assert.equal(r.data?.result?.protocolVersion, "2025-03-26", "should return protocolVersion");
    console.log("✓ testInitialize passed");
  });
}

function testToolsList(): Promise<void> {
  const app = express(); app.use(express.json());
  registerMcpEndpoint(app, new ConversationStore(":memory:", TEST_CONFIG_DIR));
  return postJson(app, { jsonrpc: "2.0", id: 2, method: "tools/list" }).then((r: any) => {
    assert.equal(r.data?.result?.tools?.[0]?.name, "set_final_body", "should list set_final_body");
    console.log("✓ testToolsList passed");
  });
}

function testRejectsEmptyText(): Promise<void> {
  const app = express(); app.use(express.json());
  registerMcpEndpoint(app, new ConversationStore(":memory:", TEST_CONFIG_DIR));
  return postJson(app, {
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "set_final_body", arguments: { text: "", conversation_id: "c1", message_id: "1" } },
  }).then((r: any) => {
    assert.ok(r.data?.result?.content?.[0]?.text?.includes("is required"), "empty text should be rejected");
    console.log("✓ testRejectsEmptyText passed");
  });
}

function testRejectsMissingConvId(): Promise<void> {
  const app = express(); app.use(express.json());
  registerMcpEndpoint(app, new ConversationStore(":memory:", TEST_CONFIG_DIR));
  return postJson(app, {
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "set_final_body", arguments: { text: "hello", conversation_id: "", message_id: "1" } },
  }).then((r: any) => {
    assert.ok(r.data?.result?.content?.[0]?.text?.includes("required"), "missing conversation_id should be rejected");
    console.log("✓ testRejectsMissingConvId passed");
  });
}

function testRejectsUnknownTool(): Promise<void> {
  const app = express(); app.use(express.json());
  registerMcpEndpoint(app, new ConversationStore(":memory:", TEST_CONFIG_DIR));
  return postJson(app, {
    jsonrpc: "2.0", id: 5, method: "tools/call",
    params: { name: "nonexistent", arguments: {} },
  }).then((r: any) => {
    assert.ok(r.data?.result?.content?.[0]?.text?.includes("Unknown tool"), "unknown tool should be rejected");
    console.log("✓ testRejectsUnknownTool passed");
  });
}

// ── 6. set_final_body 成功写入 mcp_final_body context ──
function testWritesMcpFinalBody(): Promise<void> {
  const store = new ConversationStore(":memory:", TEST_CONFIG_DIR);
  const app = express(); app.use(express.json());
  registerMcpEndpoint(app, store);
  const { convId, msgId } = createMessage(store);

  return postJson(app, {
    jsonrpc: "2.0", id: 10, method: "tools/call",
    params: { name: "set_final_body", arguments: { text: "Hello MCP", conversation_id: convId, message_id: String(msgId) } },
  }).then((r: any) => {
    assert.equal(r.data?.result?.content?.[0]?.text, JSON.stringify({ ok: true }), "should succeed");
    const ctx = store.getMessageContext(msgId, convId);
    assert.ok(ctx, "context should exist after set_final_body");
    assert.equal(ctx!.kind, "mcp_final_body", "kind should be mcp_final_body");
    assert.equal(ctx!.context, "Hello MCP", "text should match");
    console.log("✓ testWritesMcpFinalBody passed");
  });
}

// ── 7. set_final_body 拒绝不匹配的 conversation_id ──
function testRejectsMismatchedConv(): Promise<void> {
  const store = new ConversationStore(":memory:", TEST_CONFIG_DIR);
  const app = express(); app.use(express.json());
  registerMcpEndpoint(app, store);
  const { msgId } = createMessage(store);
  const otherConv = store.createConversation({ id: "other-conv", workspaceId: "mcp-e2e", issueId: "mcp-e2e-i", stageId: "mcp-e2e-stage", title: "Other", kind: "discussion", defaultRole: "用户", participatingRoles: [] } as any)!;

  return postJson(app, {
    jsonrpc: "2.0", id: 11, method: "tools/call",
    params: { name: "set_final_body", arguments: { text: "Should not write", conversation_id: otherConv.id, message_id: String(msgId) } },
  }).then((r: any) => {
    const errText = r.data?.result?.content?.[0]?.text ?? "";
    assert.ok(errText.includes("does not belong"), "wrong conversation should be rejected");
    // 验证 context 未被污染
    const ctx = store.getMessageContext(msgId, otherConv.id);
    assert.ok(!ctx, "context should NOT exist for wrong conversation");
    console.log("✓ testRejectsMismatchedConv passed");
  });
}

Promise.resolve()
  .then(testInitialize)
  .then(testToolsList)
  .then(testRejectsEmptyText)
  .then(testRejectsMissingConvId)
  .then(testRejectsUnknownTool)
  .then(testWritesMcpFinalBody)
  .then(testRejectsMismatchedConv)
  .then(() => console.log("\nmcp-endpoint tests passed"))
  .catch((err) => { console.error("FAILED:", err.stack || err); process.exit(1); });
