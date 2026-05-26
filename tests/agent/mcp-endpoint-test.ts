import assert from "assert";
import http from "http";
import express from "express";
import { ConversationStore } from "../../src/persistence/store";
import { registerMcpEndpoint } from "../../src/interaction-entry/api/server";

function postJson(app: express.Express, body: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") { server.close(); reject(new Error("bad address")); return; }
      const port = typeof addr === "object" ? addr.port : 0;
      const req = http.request({ hostname: "127.0.0.1", port, path: "/mcp", method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
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

function testInitialize(): Promise<void> {
  const app = express(); app.use(express.json());
  registerMcpEndpoint(app, new ConversationStore(":memory:"));
  return postJson(app, { jsonrpc: "2.0", id: 1, method: "initialize" }).then((r: any) => {
    assert.ok(r.data?.result?.serverInfo, "should return serverInfo");
    console.log("✓ testInitialize passed");
  });
}

function testToolsList(): Promise<void> {
  const app = express(); app.use(express.json());
  registerMcpEndpoint(app, new ConversationStore(":memory:"));
  return postJson(app, { jsonrpc: "2.0", id: 2, method: "tools/list" }).then((r: any) => {
    const tools = r.data?.result?.tools ?? [];
    assert.equal(tools[0]?.name, "set_final_body", "should list set_final_body");
    assert.ok(tools[0]?.inputSchema?.required?.includes("text"), "should require text");
    assert.ok(tools[0]?.inputSchema?.required?.includes("conversation_id"), "should require conversation_id");
    console.log("✓ testToolsList passed");
  });
}

function testRejectsEmptyText(): Promise<void> {
  const app = express(); app.use(express.json());
  registerMcpEndpoint(app, new ConversationStore(":memory:"));
  return postJson(app, {
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "set_final_body", arguments: { text: "", conversation_id: "c1", message_id: "1" } },
  }).then((r: any) => {
    assert.ok(r.data?.result?.content?.[0]?.text?.includes("is required"), "empty text should be rejected");
    console.log("✓ testRejectsEmptyText passed");
  });
}

function testRejectsMissingConversationId(): Promise<void> {
  const app = express(); app.use(express.json());
  registerMcpEndpoint(app, new ConversationStore(":memory:"));
  return postJson(app, {
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "set_final_body", arguments: { text: "hello", conversation_id: "", message_id: "1" } },
  }).then((r: any) => {
    assert.ok(r.data?.result?.content?.[0]?.text?.includes("required"), "missing conversation_id should be rejected");
    console.log("✓ testRejectsMissingConversationId passed");
  });
}

Promise.resolve()
  .then(testInitialize)
  .then(testToolsList)
  .then(testRejectsEmptyText)
  .then(testRejectsMissingConversationId)
  .then(() => console.log("\nmcp-endpoint tests passed"))
  .catch((err) => { console.error("FAILED:", err.stack || err); process.exit(1); });
