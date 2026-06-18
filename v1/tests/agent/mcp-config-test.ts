import assert from "assert";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";

import { ensureMcpServers } from "../../src/agent/mcp-config";

const tmpDir = fs.mkdtempSync(path.join(tmpdir(), "snail-mcp-test-"));

function cleanup(file: string): void {
  try { fs.unlinkSync(file); } catch { /* file may not exist */ }
}

// ── Claude Code: .claude/mcp.json ──

function testClaudeCreatesNewConfig(): void {
  const wsRoot = path.join(tmpDir, "ws-claude-1");
  fs.mkdirSync(wsRoot, { recursive: true });
  const configPath = path.join(wsRoot, ".claude", "mcp.json");
  cleanup(configPath);

  ensureMcpServers(
    [{ name: "test-server", url: "http://localhost:3000/snail-final-response" }],
    wsRoot,
    "claude",
  );

  assert.ok(fs.existsSync(configPath), ".claude/mcp.json should be created");
  const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  assert.ok(content.mcpServers, "should have mcpServers key");
  assert.ok(content.mcpServers["test-server"], "should have test-server entry");
  const entry = content.mcpServers["test-server"];
  assert.equal(entry.type, "http", "type should be http (native transport)");
  assert.equal(entry.url, "http://localhost:3000/snail-final-response", "url should match");
  console.log("✓ testClaudeCreatesNewConfig passed");
}

function testClaudePreservesExistingServers(): void {
  const wsRoot = path.join(tmpDir, "ws-claude-2");
  fs.mkdirSync(path.join(wsRoot, ".claude"), { recursive: true });
  const configPath = path.join(wsRoot, ".claude", "mcp.json");

  const userConfig = {
    mcpServers: {
      "my-custom-tool": { command: "python", args: ["tool.py"] },
    },
  };
  fs.writeFileSync(configPath, JSON.stringify(userConfig, null, 2) + "\n");

  ensureMcpServers(
    [{ name: "snail-final-response", url: "http://localhost:3000/snail-final-response" }],
    wsRoot,
    "claude",
  );

  const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  assert.ok(content.mcpServers["my-custom-tool"], "user's custom tool should be preserved");
  assert.equal(content.mcpServers["my-custom-tool"].command, "python", "user tool command should persist");
  assert.ok(content.mcpServers["snail-final-response"], "snail-final-response should be added");
  console.log("✓ testClaudePreservesExistingServers passed");
}

function testClaudeNativeHttpFormat(): void {
  const wsRoot = path.join(tmpDir, "ws-claude-3");
  fs.mkdirSync(wsRoot, { recursive: true });
  const configPath = path.join(wsRoot, ".claude", "mcp.json");
  cleanup(configPath);

  ensureMcpServers(
    [{ name: "test", url: "http://localhost:9999/test" }],
    wsRoot,
    "claude",
  );

  const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const entry = content.mcpServers["test"];
  assert.equal(entry.type, "http", "should use native HTTP transport");
  assert.equal(entry.url, "http://localhost:9999/test", "url should match");
  assert.equal(entry.command, undefined, "should not have command (no mcp-remote bridge)");
  console.log("✓ testClaudeNativeHttpFormat passed");
}

// ── Codex: .codex/config.toml ──

function testCodexCreatesNewConfig(): void {
  const wsRoot = path.join(tmpDir, "ws-codex-1");
  fs.mkdirSync(wsRoot, { recursive: true });
  const configPath = path.join(wsRoot, ".codex", "config.toml");

  ensureMcpServers(
    [{ name: "test-server", url: "http://localhost:3000/snail-final-response" }],
    wsRoot,
    "codex",
  );

  assert.ok(fs.existsSync(configPath), ".codex/config.toml should be created");
  const content = fs.readFileSync(configPath, "utf-8");
  assert.ok(content.includes("[mcp_servers.test-server]"), "should have mcp_servers section");
  assert.ok(content.includes('url = "http://localhost:3000/snail-final-response"'), "should have url");
  console.log("✓ testCodexCreatesNewConfig passed");
}

function testCodexPreservesGuardConfig(): void {
  const wsRoot = path.join(tmpDir, "ws-codex-2");
  fs.mkdirSync(path.join(wsRoot, ".codex"), { recursive: true });
  const configPath = path.join(wsRoot, ".codex", "config.toml");

  // 先写入 guard config（模拟 writeCodexGuardConfig 的输出）
  const guardConfig = [
    "# Codex 配置 — Snail Shell GuardProfile 翻译生成",
    "",
    'sandbox_mode = "read-only"',
    "",
  ].join("\n");
  fs.writeFileSync(configPath, guardConfig);

  ensureMcpServers(
    [{ name: "test-server", url: "http://localhost:3000/snail-final-response" }],
    wsRoot,
    "codex",
  );

  const content = fs.readFileSync(configPath, "utf-8");
  assert.ok(content.includes('sandbox_mode = "read-only"'), "guard config should be preserved");
  assert.ok(content.includes("[mcp_servers.test-server]"), "should have mcp_servers section");
  console.log("✓ testCodexPreservesGuardConfig passed");
}

function testCodexNoGlobalWrite(): void {
  const wsRoot = path.join(tmpDir, "ws-codex-3");
  fs.mkdirSync(wsRoot, { recursive: true });

  ensureMcpServers(
    [{ name: "test", url: "http://localhost:3000/test" }],
    wsRoot,
    "codex",
  );

  // 验证没有写到 global ~/.codex/config.toml
  // 注意：我们不检查 global ~/.codex/config.toml 是否存在（可能用户有自己的配置），
  // 只验证工作区本地的文件存在
  const localPath = path.join(wsRoot, ".codex", "config.toml");
  assert.ok(fs.existsSync(localPath), "should write to workspace-local .codex/config.toml");
  console.log("✓ testCodexNoGlobalWrite passed");
}

// ── OpenCode: opencode.json ──

function testOpenCodeCreatesNewConfig(): void {
  const wsRoot = path.join(tmpDir, "ws-opencode-1");
  fs.mkdirSync(wsRoot, { recursive: true });
  const configPath = path.join(wsRoot, "opencode.json");

  ensureMcpServers(
    [{ name: "test-server", url: "http://localhost:3000/snail-final-response" }],
    wsRoot,
    "opencode",
  );

  assert.ok(fs.existsSync(configPath), "opencode.json should be created");
  const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  assert.ok(content.mcp, "should have mcp key");
  assert.ok(content.mcp["test-server"], "should have test-server entry");
  const entry = content.mcp["test-server"];
  assert.equal(entry.type, "remote", "type should be remote for URL");
  assert.equal(entry.url, "http://localhost:3000/snail-final-response", "url should match");
  console.log("✓ testOpenCodeCreatesNewConfig passed");
}

function testOpenCodeStdioFormat(): void {
  const wsRoot = path.join(tmpDir, "ws-opencode-2");
  fs.mkdirSync(wsRoot, { recursive: true });
  const configPath = path.join(wsRoot, "opencode.json");

  ensureMcpServers(
    [{ name: "stdio-tool", command: "npx", args: ["-y", "some-server"], env: { TOKEN: "abc" } }],
    wsRoot,
    "opencode",
  );

  const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const entry = content.mcp["stdio-tool"];
  assert.equal(entry.type, "local", "type should be local for stdio");
  assert.deepEqual(entry.command, ["npx", "-y", "some-server"], "command should be array with args merged");
  assert.deepEqual(entry.environment, { TOKEN: "abc" }, "environment should match");
  console.log("✓ testOpenCodeStdioFormat passed");
}

function testOpenCodePreservesExistingConfig(): void {
  const wsRoot = path.join(tmpDir, "ws-opencode-3");
  fs.mkdirSync(wsRoot, { recursive: true });
  const configPath = path.join(wsRoot, "opencode.json");

  // 写入已有配置（含 provider 等非 MCP 字段）
  const existingConfig = {
    "$schema": "https://opencode.ai/config.json",
    provider: { "my-provider": { name: "test" } },
    mcp: { "existing-server": { type: "remote", url: "http://existing:8080" } },
  };
  fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2) + "\n");

  ensureMcpServers(
    [{ name: "new-server", url: "http://localhost:3000/test" }],
    wsRoot,
    "opencode",
  );

  const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  assert.ok(content.provider, "provider should be preserved");
  assert.ok(content.mcp["existing-server"], "existing MCP server should be preserved");
  assert.ok(content.mcp["new-server"], "new MCP server should be added");
  console.log("✓ testOpenCodePreservesExistingConfig passed");
}

function testOpenCodeNoGlobalWrite(): void {
  const wsRoot = path.join(tmpDir, "ws-opencode-4");
  fs.mkdirSync(wsRoot, { recursive: true });

  ensureMcpServers(
    [{ name: "test", url: "http://localhost:3000/test" }],
    wsRoot,
    "opencode",
  );

  const localPath = path.join(wsRoot, "opencode.json");
  assert.ok(fs.existsSync(localPath), "should write to workspace-local opencode.json");
  console.log("✓ testOpenCodeNoGlobalWrite passed");
}

// ── Claude Code: settings.json cleanup ──

function testClaudeCleansUpLegacyEnabledMcpjsonServers(): void {
  const wsRoot = path.join(tmpDir, "ws-settings-cleanup-1");
  fs.mkdirSync(path.join(wsRoot, ".claude"), { recursive: true });
  const settingsPath = path.join(wsRoot, ".claude", "settings.json");

  const existingSettings = {
    enableAllProjectMcpServers: true,
    enabledMcpjsonServers: ["old-server"],
  };
  fs.writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2) + "\n");

  ensureMcpServers(
    [{ name: "snail-final-response", url: "http://localhost:3000/snail-final-response" }],
    wsRoot,
    "claude",
  );

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  assert.equal(settings.enableAllProjectMcpServers, true, "existing field should be preserved");
  assert.equal(settings.enabledMcpjsonServers, undefined, "legacy enabledMcpjsonServers should be removed");
  console.log("✓ testClaudeCleansUpLegacyEnabledMcpjsonServers passed");
}

function testClaudeCleanupNoopWhenNoLegacyField(): void {
  const wsRoot = path.join(tmpDir, "ws-settings-cleanup-2");
  fs.mkdirSync(path.join(wsRoot, ".claude"), { recursive: true });
  const settingsPath = path.join(wsRoot, ".claude", "settings.json");

  const existingSettings = {
    enableAllProjectMcpServers: true,
    customField: "preserved",
  };
  fs.writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2) + "\n");

  ensureMcpServers(
    [{ name: "snail-final-response", url: "http://localhost:3000/snail-final-response" }],
    wsRoot,
    "claude",
  );

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  assert.equal(settings.enableAllProjectMcpServers, true, "existing field should be preserved");
  assert.equal(settings.customField, "preserved", "custom field should be preserved");
  assert.equal(settings.enabledMcpjsonServers, undefined, "no enabledMcpjsonServers should be added");
  console.log("✓ testClaudeCleanupNoopWhenNoLegacyField passed");
}

function testClaudeCleanupNoopWhenNoSettingsFile(): void {
  const wsRoot = path.join(tmpDir, "ws-settings-cleanup-3");
  fs.mkdirSync(wsRoot, { recursive: true });
  const settingsPath = path.join(wsRoot, ".claude", "settings.json");
  cleanup(settingsPath);

  ensureMcpServers(
    [{ name: "snail-final-response", url: "http://localhost:3000/snail-final-response" }],
    wsRoot,
    "claude",
  );

  // settings.json should not be created just for cleanup
  assert.ok(!fs.existsSync(settingsPath), "settings.json should not be created when no legacy field exists");
  console.log("✓ testClaudeCleanupNoopWhenNoSettingsFile passed");
}

// ── Edge cases ──

function testSkipsOnEmptyServers(): void {
  const wsRoot = path.join(tmpDir, "ws-empty");
  fs.mkdirSync(wsRoot, { recursive: true });

  // 应该不创建任何文件
  ensureMcpServers([], wsRoot, "claude");
  const configPath = path.join(wsRoot, ".claude", "mcp.json");
  assert.ok(!fs.existsSync(configPath), "should not create config for empty servers");
  console.log("✓ testSkipsOnEmptyServers passed");
}

function testStdioServerConfig(): void {
  const wsRoot = path.join(tmpDir, "ws-stdio");
  fs.mkdirSync(wsRoot, { recursive: true });
  const configPath = path.join(wsRoot, ".claude", "mcp.json");
  cleanup(configPath);

  ensureMcpServers(
    [{ name: "stdio-tool", command: "node", args: ["tool.js"], env: { TOKEN: "abc" } }],
    wsRoot,
    "claude",
  );

  const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const entry = content.mcpServers["stdio-tool"];
  assert.equal(entry.command, "node", "command should be node");
  assert.deepEqual(entry.args, ["tool.js"], "args should match");
  assert.deepEqual(entry.env, { TOKEN: "abc" }, "env should match");
  console.log("✓ testStdioServerConfig passed");
}

// Run tests
try {
  testClaudeCreatesNewConfig();
  testClaudePreservesExistingServers();
  testClaudeNativeHttpFormat();
  testCodexCreatesNewConfig();
  testCodexPreservesGuardConfig();
  testCodexNoGlobalWrite();
  testOpenCodeCreatesNewConfig();
  testOpenCodeStdioFormat();
  testOpenCodePreservesExistingConfig();
  testOpenCodeNoGlobalWrite();
  testClaudeCleansUpLegacyEnabledMcpjsonServers();
  testClaudeCleanupNoopWhenNoLegacyField();
  testClaudeCleanupNoopWhenNoSettingsFile();
  testSkipsOnEmptyServers();
  testStdioServerConfig();
  console.log("\nmcp-config tests passed");
} finally {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup */ }
}
