import assert from "assert";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";

import { ensureMcpServers } from "@infra/acs/_internal/utils/mcp-config";

const tmpDir = fs.mkdtempSync(path.join(tmpdir(), "snail-mcp-config-v2-test-"));

function cleanup(file: string): void {
  try { fs.unlinkSync(file); } catch { /* file may not exist */ }
}

// ── B1: Claude Code 生成原生 HTTP 格式 ──

function testClaudeGeneratesNativeHttpFormat(): void {
  const wsRoot = path.join(tmpDir, "ws-b1");
  fs.mkdirSync(wsRoot, { recursive: true });
  const configPath = path.join(wsRoot, ".claude", "mcp.json");
  cleanup(configPath);

  ensureMcpServers(
    [{ name: "snail-final-response", url: "http://localhost:3000/mcp/snail-final-response" }],
    wsRoot,
    "claude",
  );

  assert.ok(fs.existsSync(configPath), ".claude/mcp.json should be created");
  const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  assert.ok(content.mcpServers, "should have mcpServers key");

  const entry = content.mcpServers["snail-final-response"];
  assert.ok(entry, "should have snail-final-response entry");
  assert.equal(entry.type, "http", "type should be http (native transport)");
  assert.equal(entry.url, "http://localhost:3000/mcp/snail-final-response", "url should match");
  assert.equal(entry.command, undefined, "should not have command (no mcp-remote bridge)");
  assert.equal(entry.args, undefined, "should not have args (no mcp-remote bridge)");
  console.log("✓ testClaudeGeneratesNativeHttpFormat passed");
}

// ── 清理遗留 enabledMcpjsonServers ──

function testCleanupRemovesLegacyField(): void {
  const wsRoot = path.join(tmpDir, "ws-cleanup-1");
  fs.mkdirSync(path.join(wsRoot, ".claude"), { recursive: true });
  const settingsPath = path.join(wsRoot, ".claude", "settings.json");

  fs.writeFileSync(settingsPath, JSON.stringify({
    enableAllProjectMcpServers: true,
    enabledMcpjsonServers: ["old-server"],
  }, null, 2) + "\n");

  ensureMcpServers(
    [{ name: "snail-final-response", url: "http://localhost:3000/mcp/snail-final-response" }],
    wsRoot,
    "claude",
  );

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  assert.equal(settings.enableAllProjectMcpServers, true, "existing field should be preserved");
  assert.equal(settings.enabledMcpjsonServers, undefined, "legacy field should be removed");
  console.log("✓ testCleanupRemovesLegacyField passed");
}

function testCleanupNoopWhenNoLegacyField(): void {
  const wsRoot = path.join(tmpDir, "ws-cleanup-2");
  fs.mkdirSync(path.join(wsRoot, ".claude"), { recursive: true });
  const settingsPath = path.join(wsRoot, ".claude", "settings.json");

  fs.writeFileSync(settingsPath, JSON.stringify({
    enableAllProjectMcpServers: true,
  }, null, 2) + "\n");

  ensureMcpServers(
    [{ name: "snail-final-response", url: "http://localhost:3000/mcp/snail-final-response" }],
    wsRoot,
    "claude",
  );

  const raw = fs.readFileSync(settingsPath, "utf-8");
  const settings = JSON.parse(raw);
  assert.equal(settings.enableAllProjectMcpServers, true, "existing field should be preserved");
  assert.ok(!("enabledMcpjsonServers" in settings), "should not add enabledMcpjsonServers");
  console.log("✓ testCleanupNoopWhenNoLegacyField passed");
}

function testCleanupNoopWhenNoSettingsFile(): void {
  const wsRoot = path.join(tmpDir, "ws-cleanup-3");
  fs.mkdirSync(wsRoot, { recursive: true });
  const settingsPath = path.join(wsRoot, ".claude", "settings.json");
  cleanup(settingsPath);

  ensureMcpServers(
    [{ name: "snail-final-response", url: "http://localhost:3000/mcp/snail-final-response" }],
    wsRoot,
    "claude",
  );

  assert.ok(!fs.existsSync(settingsPath), "should not create settings.json just for cleanup");
  console.log("✓ testCleanupNoopWhenNoSettingsFile passed");
}

// ── 边界场景 ──

function testSkipsOnEmptyServers(): void {
  const wsRoot = path.join(tmpDir, "ws-empty");
  fs.mkdirSync(wsRoot, { recursive: true });

  ensureMcpServers([], wsRoot, "claude");
  const configPath = path.join(wsRoot, ".claude", "mcp.json");
  assert.ok(!fs.existsSync(configPath), "should not create config for empty servers");
  console.log("✓ testSkipsOnEmptyServers passed");
}

function testPreservesExistingServers(): void {
  const wsRoot = path.join(tmpDir, "ws-preserve");
  fs.mkdirSync(path.join(wsRoot, ".claude"), { recursive: true });
  const configPath = path.join(wsRoot, ".claude", "mcp.json");

  fs.writeFileSync(configPath, JSON.stringify({
    mcpServers: {
      "my-custom-tool": { command: "python", args: ["tool.py"] },
    },
  }, null, 2) + "\n");

  ensureMcpServers(
    [{ name: "snail-final-response", url: "http://localhost:3000/mcp/snail-final-response" }],
    wsRoot,
    "claude",
  );

  const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  assert.ok(content.mcpServers["my-custom-tool"], "user's custom tool should be preserved");
  assert.equal(content.mcpServers["my-custom-tool"].command, "python", "user tool should be unchanged");
  assert.ok(content.mcpServers["snail-final-response"], "new server should be added");
  console.log("✓ testPreservesExistingServers passed");
}

// Run tests
try {
  testClaudeGeneratesNativeHttpFormat();
  testCleanupRemovesLegacyField();
  testCleanupNoopWhenNoLegacyField();
  testCleanupNoopWhenNoSettingsFile();
  testSkipsOnEmptyServers();
  testPreservesExistingServers();
  console.log("\nmcp-config v2 tests passed");
} finally {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup */ }
}
