import assert from "assert";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";

import { mergeMcpJson } from "../../src/agent/mcp-config";

const tmpDir = fs.mkdtempSync(path.join(tmpdir(), "snail-mcp-test-"));
const mcpJsonPath = path.join(tmpDir, ".mcp.json");

function cleanup(): void {
  try { fs.unlinkSync(mcpJsonPath); } catch { /* file may not exist */ }
}

function testCreatesNewMcpJson(): void {
  cleanup();
  mergeMcpJson(mcpJsonPath, 3000);
  assert.ok(fs.existsSync(mcpJsonPath), ".mcp.json should be created");
  const content = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8"));
  assert.ok(content.mcpServers, "should have mcpServers key");
  assert.ok(content.mcpServers["snail-final-body"], "should have snail-final-body entry");
  const entry = content.mcpServers["snail-final-body"];
  assert.equal(entry.command, "npx", "command should be npx (mcp-remote bridge)");
  assert.deepEqual(entry.args, ["mcp-remote", "http://localhost:3000/mcp"], "args should use mcp-remote bridge");
  console.log("✓ testCreatesNewMcpJson passed");
}

function testPreservesUserMcpServers(): void {
  cleanup();
  const userConfig = {
    mcpServers: {
      "my-custom-tool": { command: "python", args: ["tool.py"] },
    },
  };
  fs.writeFileSync(mcpJsonPath, JSON.stringify(userConfig, null, 2) + "\n");

  mergeMcpJson(mcpJsonPath, 8080);

  const content = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8"));
  assert.ok(content.mcpServers["my-custom-tool"], "user's custom tool should be preserved");
  assert.equal(content.mcpServers["my-custom-tool"].command, "python", "user tool command should persist");
  assert.ok(content.mcpServers["snail-final-body"], "snail-final-body should be added");
  const entry = content.mcpServers["snail-final-body"];
  assert.equal(entry.command, "npx", "command should be npx (mcp-remote bridge)");
  assert.deepEqual(entry.args, ["mcp-remote", "http://localhost:8080/mcp"], "args should use mcp-remote bridge");
  console.log("✓ testPreservesUserMcpServers passed");
}

function testUpdatesExistingEntry(): void {
  cleanup();
  const existingConfig = {
    mcpServers: {
      "snail-final-body": { url: "http://localhost:9999/mcp" },
      "other-tool": { command: "node" },
    },
  };
  fs.writeFileSync(mcpJsonPath, JSON.stringify(existingConfig, null, 2) + "\n");

  mergeMcpJson(mcpJsonPath, 4321);

  const content = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8"));
  const entry = content.mcpServers["snail-final-body"];
  assert.equal(entry.command, "npx", "command should be npx (mcp-remote bridge)");
  assert.deepEqual(entry.args, ["mcp-remote", "http://localhost:4321/mcp"], "args should use new port");
  assert.ok(content.mcpServers["other-tool"], "other tool should be preserved");
  console.log("✓ testUpdatesExistingEntry passed");
}

function testHandlesMissingMcpServersKey(): void {
  cleanup();
  fs.writeFileSync(mcpJsonPath, JSON.stringify({ someOtherKey: "value" }, null, 2) + "\n");

  mergeMcpJson(mcpJsonPath, 3000);

  const content = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8"));
  assert.ok(content.mcpServers, "mcpServers should be created");
  assert.ok(content.mcpServers["snail-final-body"], "snail-final-body should be added");
  assert.equal(content.someOtherKey, "value", "other keys should be preserved");
  console.log("✓ testHandlesMissingMcpServersKey passed");
}

function testHandlesNonObjectMcpServers(): void {
  cleanup();
  fs.writeFileSync(mcpJsonPath, JSON.stringify({ mcpServers: "not-an-object" }, null, 2) + "\n");

  mergeMcpJson(mcpJsonPath, 3000);

  const content = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8"));
  assert.ok(content.mcpServers, "mcpServers should be an object");
  assert.equal(typeof content.mcpServers, "object", "mcpServers should be an object after merge");
  console.log("✓ testHandlesNonObjectMcpServers passed");
}

function testPreservesTopLevelKeys(): void {
  cleanup();
  const config = { name: "test-project", version: "1.0", mcpServers: {} };
  fs.writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + "\n");

  mergeMcpJson(mcpJsonPath, 3000);

  const content = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8"));
  assert.equal(content.name, "test-project", "name should be preserved");
  assert.equal(content.version, "1.0", "version should be preserved");
  console.log("✓ testPreservesTopLevelKeys passed");
}

function testDoesNotOverwriteOnParseFailure(): void {
  cleanup();
  // 写入非法 JSON（用户 .mcp.json 暂时损坏、手写 JSONC 等）
  const invalidJson = '{\n  // comment\n  "mcpServers": {}\n}\n';
  fs.writeFileSync(mcpJsonPath, invalidJson, "utf-8");

  mergeMcpJson(mcpJsonPath, 3000);

  // 文件内容应保持不变（不会被覆盖为合法 JSON）
  const content = fs.readFileSync(mcpJsonPath, "utf-8");
  assert.equal(content, invalidJson, "file content must be preserved on parse failure");
  console.log("✓ testDoesNotOverwriteOnParseFailure passed");
}

// Run tests
try {
  testCreatesNewMcpJson();
  testPreservesUserMcpServers();
  testUpdatesExistingEntry();
  testHandlesMissingMcpServersKey();
  testHandlesNonObjectMcpServers();
  testPreservesTopLevelKeys();
  testDoesNotOverwriteOnParseFailure();
  console.log("\nmcp-config tests passed");
} finally {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup */ }
}
