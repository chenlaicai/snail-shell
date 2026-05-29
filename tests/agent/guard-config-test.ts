/**
 * guard-config.ts 单元测试（扁平模型版本）
 *
 * 覆盖：
 * - DEFAULT_GUARD_PROFILE 从 config/guard-profile.json 加载（allow/deny 数组）
 * - resolveGuardProfile 的合并行为（null、追加、非法回退）
 * - translateToClaudeSettings / translateToCodexConfigToml 翻译
 * - writeClaudeGuardSettings / writeCodexGuardConfig 合并写入
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawnSync } from "child_process";
import { DEFAULT_GUARD_PROFILE, resolveGuardProfile, translateToClaudeSettings, translateToCodexConfigToml, writeClaudeGuardSettings, writeCodexGuardConfig } from "../../src/agent/guard-config";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// ──── DEFAULT_GUARD_PROFILE 加载 ────

function testDefaultProfileHasAllowDeny(): void {
  assert(Array.isArray(DEFAULT_GUARD_PROFILE.allow), "allow must be an array");
  assert(Array.isArray(DEFAULT_GUARD_PROFILE.deny), "deny must be an array");
  assert(DEFAULT_GUARD_PROFILE.allow.length > 0, "allow should not be empty");
  assert(DEFAULT_GUARD_PROFILE.deny.length > 0, "deny should not be empty");
  console.log("✓ testDefaultProfileHasAllowDeny passed");
}

// ──── resolveGuardProfile ────

function testResolveNullReturnsDefault(): void {
  const resolved = resolveGuardProfile(null);
  assert(resolved.allow === DEFAULT_GUARD_PROFILE.allow, "null should return default allow");
  assert(resolved.deny === DEFAULT_GUARD_PROFILE.deny, "null should return default deny");
  console.log("✓ testResolveNullReturnsDefault passed");
}

function testResolveUndefinedReturnsDefault(): void {
  const resolved = resolveGuardProfile(undefined);
  assert(resolved.allow.length === DEFAULT_GUARD_PROFILE.allow.length, "undefined should return default");
  console.log("✓ testResolveUndefinedReturnsDefault passed");
}

function testResolveEmptyObjectReturnsDefault(): void {
  const resolved = resolveGuardProfile({});
  assert(resolved.allow.length === DEFAULT_GUARD_PROFILE.allow.length, "empty object should use default allow");
  console.log("✓ testResolveEmptyObjectReturnsDefault passed");
}

function testProjectAllowAppendsToDefault(): void {
  const resolved = resolveGuardProfile({ allow: ["Bash(my-custom:*)"], deny: [] });
  assert(resolved.allow.includes("Bash(my-custom:*)"), "project allow should be appended");
  assert(resolved.allow[resolved.allow.length - 1] === "Bash(my-custom:*)", "project allow should be last");
  console.log("✓ testProjectAllowAppendsToDefault passed");
}

function testProjectDenyAppendsToDefault(): void {
  const resolved = resolveGuardProfile({ deny: ["Bash(dangerous:*)"], allow: [] });
  assert(resolved.deny.includes("Bash(dangerous:*)"), "project deny should be appended");
  console.log("✓ testProjectDenyAppendsToDefault passed");
}

function testNonArrayFieldsFiltered(): void {
  const resolved = resolveGuardProfile({ allow: ["Bash(ok:*)", 42, null, true], deny: [null, undefined] });
  // project allow/deny 追加到 default 之上，非字符串被过滤
  assert(resolved.allow.includes("Bash(ok:*)"), "valid string should be kept in allow");
  assert(!resolved.allow.includes(42 as any), "non-string should be filtered from allow");
  assert(resolved.deny.length === DEFAULT_GUARD_PROFILE.deny.length, "empty deny project array should not add entries");
  console.log("✓ testNonArrayFieldsFiltered passed");
}

// ──── translateToClaudeSettings ────

function testTranslateToClaudeSettings(): void {
  const guard = { allow: ["Bash(node:*)", "Edit"], deny: ["Bash(sqlite3:*)"] };
  const result = translateToClaudeSettings(guard);
  assert(result.allow.length === 2, "allow should have 2 entries");
  assert(result.deny.length === 1, "deny should have 1 entry");
  assert(result.allow.includes("Edit"), "allow should include Edit");
  assert(result.deny.includes("Bash(sqlite3:*)"), "deny should include Bash(sqlite3:*)");
  console.log("✓ testTranslateToClaudeSettings passed");
}

// ──── translateToCodexConfigToml ────

function testCodexConfigDefaultsToWorkspaceWrite(): void {
  const guard = { allow: ["Bash(node:*)"], deny: [] };
  const toml = translateToCodexConfigToml(guard);
  assert(toml.includes("workspace-write"), "empty deny should default to workspace-write");
  console.log("✓ testCodexConfigDefaultsToWorkspaceWrite passed");
}

function testCodexConfigRestrictiveDenyGoesReadOnly(): void {
  const guard = { allow: [], deny: ["Bash(rm -rf /:*)"] };
  const toml = translateToCodexConfigToml(guard);
  assert(toml.includes("read-only"), "restrictive deny should set read-only");
  console.log("✓ testCodexConfigRestrictiveDenyGoesReadOnly passed");
}

// ──── writeClaudeGuardSettings ────

function testWriteClaudeGuardSettingsCreatesFile(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const guard = { allow: ["Bash(node:*)"], deny: ["Bash(rm -rf /:*)"] };
  writeClaudeGuardSettings(guard, tmpDir);

  const settingsPath = path.join(tmpDir, ".claude", "settings.local.json");
  assert(fs.existsSync(settingsPath), "settings.local.json should be created");
  const content = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  assert(Array.isArray(content.permissions.allow), "permissions.allow should exist");
  assert(content.permissions.allow.includes("Bash(node:*)"), "allow should contain node:*");
  assert(content.permissions.deny.includes("Bash(rm -rf /:*)"), "deny should contain rm -rf");

  // 验证 PreToolUse hook 格式符合 Claude Code 要求：{ matcher, hooks: [{ type, command }] }
  const preToolUse = content.hooks?.PreToolUse;
  assert(Array.isArray(preToolUse), "hooks.PreToolUse should be an array");
  const guardHook = preToolUse.find((h: any) =>
    Array.isArray(h.hooks) && h.hooks.some((inner: any) => typeof inner.command === "string" && inner.command.includes("guard-bash.js"))
  );
  assert(guardHook, "guard-bash hook entry should exist with correct format");
  assert(guardHook.matcher === "Bash", "guard-bash hook matcher should be Bash");
  assert(guardHook.hooks[0].type === "command", "guard-bash hook type should be command");

  // 验证没有旧格式（command 直接在 entry 上）的 guard-bash 条目
  const oldFormatHook = preToolUse.find((h: any) => typeof h.command === "string" && h.command.includes("guard-bash.js"));
  assert(!oldFormatHook, "should not have old-format guard-bash hook entry");

  const guardProfilePath = path.join(tmpDir, ".claude", "guard-profile.json");
  assert(fs.existsSync(guardProfilePath), "guard-profile.json should be created");

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ testWriteClaudeGuardSettingsCreatesFile passed");
}

function testWriteClaudeGuardSettingsMergesExisting(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const claudeDir = path.join(tmpDir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  // existing settings with non-Snail content
  fs.writeFileSync(path.join(claudeDir, "settings.local.json"), JSON.stringify({
    permissions: { allow: ["Bash(old:*)"], deny: [] },
    customField: "keep-me",
  }));

  const guard = { allow: ["Bash(new:*)"], deny: ["Bash(bad:*)"] };
  writeClaudeGuardSettings(guard, tmpDir);

  const content = JSON.parse(fs.readFileSync(path.join(claudeDir, "settings.local.json"), "utf-8"));
  assert(content.customField === "keep-me", "non-Snail fields should be preserved");
  assert(content.permissions.allow.includes("Bash(new:*)"), "new allow should be present");
  assert(!content.permissions.allow.includes("Bash(old:*)"), "old allow should be replaced");

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ testWriteClaudeGuardSettingsMergesExisting passed");
}

function testWriteClaudeGuardSettingsDeduplicatesHooks(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const guard = { allow: ["Bash(node:*)"], deny: [] };

  // 调用两次，不应产生重复的 guard-bash hook 条目
  writeClaudeGuardSettings(guard, tmpDir);
  writeClaudeGuardSettings(guard, tmpDir);

  const content = JSON.parse(fs.readFileSync(path.join(tmpDir, ".claude", "settings.local.json"), "utf-8"));
  const preToolUse = content.hooks?.PreToolUse;
  assert(Array.isArray(preToolUse), "hooks.PreToolUse should be an array");
  const guardHooks = preToolUse.filter((h: any) =>
    Array.isArray(h.hooks) && h.hooks.some((inner: any) => typeof inner.command === "string" && inner.command.includes("guard-bash.js"))
  );
  assert(guardHooks.length === 1, `should have exactly 1 guard-bash hook, got ${guardHooks.length}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ testWriteClaudeGuardSettingsDeduplicatesHooks passed");
}

function testWriteClaudeGuardSettingsExtraAllow(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const guard = { allow: ["Bash(node:*)"], deny: [] };
  writeClaudeGuardSettings(guard, tmpDir, ["Bash(approved-tool:*)"]);

  const content = JSON.parse(fs.readFileSync(path.join(tmpDir, ".claude", "settings.local.json"), "utf-8"));
  assert(content.permissions.allow.includes("Bash(approved-tool:*)"), "extraAllow should be added");

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ testWriteClaudeGuardSettingsExtraAllow passed");
}

/**
 * 同一 entry 内混有用户 hook + guard-bash.js 时，用户 hook 应被保留。
 * 这是 PR #304 检视意见要求覆盖的场景：只从 hooks 数组中移除 guard-bash.js，
 * 而不是删除整个 entry。
 */
function testWriteClaudeGuardSettingsPreservesMixedHooks(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const claudeDir = path.join(tmpDir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });

  const hookScriptPath = path.resolve(process.cwd(), ".meta", "hooks", "guard-bash.js");
  // 预置包含用户 hook + guard-bash.js 的混合 entry（正确格式）
  const mixedEntry = {
    matcher: "Bash",
    hooks: [
      { type: "command", command: "node /path/to/user-hook.js" },
      { type: "command", command: `node ${hookScriptPath}` },
    ],
  };
  // 纯用户 hook entry（正确格式）
  const userOnlyEntry = {
    matcher: "Edit",
    hooks: [{ type: "command", command: "node /path/to/another-hook.js" }],
  };
  // 旧格式 guard-bash entry
  const oldFormatGuard = { matcher: "Bash", command: `node ${hookScriptPath}` };

  fs.writeFileSync(path.join(claudeDir, "settings.local.json"), JSON.stringify({
    hooks: { PreToolUse: [mixedEntry, userOnlyEntry, oldFormatGuard] },
  }));

  const guard = { allow: ["Bash(node:*)"], deny: [] };
  writeClaudeGuardSettings(guard, tmpDir);

  const content = JSON.parse(fs.readFileSync(path.join(claudeDir, "settings.local.json"), "utf-8"));
  const preToolUse = content.hooks?.PreToolUse;
  assert(Array.isArray(preToolUse), "hooks.PreToolUse should be an array");

  // 1. 混合 entry 应保留，且只包含用户 hook（guard-bash.js 被移除）
  const bashEntries = preToolUse.filter((h: any) => h.matcher === "Bash");
  const preservedMixed = bashEntries.find((h: any) =>
    Array.isArray(h.hooks) && h.hooks.some((inner: any) => inner.command === "node /path/to/user-hook.js")
  );
  assert(preservedMixed, "mixed entry should be preserved with user hook");
  assert(preservedMixed.hooks.length === 1, `mixed entry should have 1 hook (user only), got ${preservedMixed.hooks.length}`);
  assert(preservedMixed.hooks[0].command === "node /path/to/user-hook.js", "only user hook should remain in mixed entry");

  // 2. guard-bash.js 应由 Snail Shell 重新添加为独立 entry
  const guardHookEntry = bashEntries.find((h: any) =>
    Array.isArray(h.hooks) && h.hooks.some((inner: any) => typeof inner.command === "string" && inner.command.includes("guard-bash.js"))
  );
  assert(guardHookEntry, "guard-bash hook should be added as a separate entry");

  // 3. 纯用户 hook entry 应原样保留
  const editEntries = preToolUse.filter((h: any) => h.matcher === "Edit");
  assert(editEntries.length === 1, "user-only Edit entry should be preserved");
  assert(editEntries[0].hooks[0].command === "node /path/to/another-hook.js", "user-only hook command should be preserved");

  // 4. 旧格式 guard-bash entry 应被移除
  const oldFormatEntries = preToolUse.filter((h: any) => typeof h.command === "string" && h.command.includes("guard-bash.js"));
  assert(oldFormatEntries.length === 0, "old-format guard-bash entry should be removed");

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ testWriteClaudeGuardSettingsPreservesMixedHooks passed");
}

// ──── writeCodexGuardConfig ────

function testWriteCodexGuardConfigCreatesFile(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const guard = { allow: ["Bash(node:*)"], deny: [] };
  writeCodexGuardConfig(guard, tmpDir);

  const configPath = path.join(tmpDir, ".codex", "config.toml");
  assert(fs.existsSync(configPath), ".codex/config.toml should be created");

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ testWriteCodexGuardConfigCreatesFile passed");
}

function testWriteCodexGuardConfigMergeInsertBeforeSection(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const codexDir = path.join(tmpDir, ".codex");
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(path.join(codexDir, "config.toml"), [
    "existing_key = \"value\"",
    "",
    "[section]",
    "nested_key = \"other\"",
  ].join("\n"));

  const guard = { allow: ["Bash(node:*)"], deny: [] };
  writeCodexGuardConfig(guard, tmpDir);

  const content = fs.readFileSync(path.join(codexDir, "config.toml"), "utf-8");
  assert(content.includes("sandbox_mode"), "sandbox_mode should be added");
  assert(content.includes("[section]"), "existing sections should be preserved");

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ testWriteCodexGuardConfigMergeInsertBeforeSection passed");
}

// ──── guard-profile.json allow/deny 加载 ────

function testAllowDenyMissingDefaultsToEmpty(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  fs.mkdirSync(path.join(tmpDir, "config"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "config", "guard-profile.json"), JSON.stringify({}));
  fs.writeFileSync(path.join(tmpDir, "config", "logging.json"), JSON.stringify({ level: "warn", directory: "logs", filename_prefix: "snail-shell", max_file_size_mb: 10 }));

  const testScript = `
    const { DEFAULT_GUARD_PROFILE } = require(${JSON.stringify(path.join(process.cwd(), "dist", "src", "agent", "guard-config.js"))});
    process.stdout.write(JSON.stringify({
      allowLen: Array.isArray(DEFAULT_GUARD_PROFILE.allow) ? DEFAULT_GUARD_PROFILE.allow.length : -1,
      denyLen: Array.isArray(DEFAULT_GUARD_PROFILE.deny) ? DEFAULT_GUARD_PROFILE.deny.length : -1,
    }));
  `;

  const result = spawnSync("node", ["-e", testScript], { cwd: tmpDir, encoding: "utf-8", timeout: 10000 });
  if (result.error) throw result.error;
  const r = JSON.parse(result.stdout.trim());
  assert(r.allowLen === 0, "missing allow should default to empty array");
  assert(r.denyLen === 0, "missing deny should default to empty array");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ testAllowDenyMissingDefaultsToEmpty passed");
}

function testCustomAllowFlowsToTranslate(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  fs.mkdirSync(path.join(tmpDir, "config"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "config", "guard-profile.json"), JSON.stringify({
    allow: ["Bash(my-custom-tool:*)", "WebSearch", "Bash(custom-echo:*)"],
    deny: [],
  }));
  fs.writeFileSync(path.join(tmpDir, "config", "logging.json"), JSON.stringify({ level: "warn", directory: "logs", filename_prefix: "snail-shell", max_file_size_mb: 10 }));

  const testScript = `
    const { translateToClaudeSettings, DEFAULT_GUARD_PROFILE } = require(${JSON.stringify(path.join(process.cwd(), "dist", "src", "agent", "guard-config.js"))});
    const s = translateToClaudeSettings(DEFAULT_GUARD_PROFILE);
    process.stdout.write(JSON.stringify({
      hasMyCustom: s.allow.includes("Bash(my-custom-tool:*)"),
      hasWebSearch: s.allow.includes("WebSearch"),
      hasCustomEcho: s.allow.includes("Bash(custom-echo:*)"),
    }));
  `;

  const result = spawnSync("node", ["-e", testScript], { cwd: tmpDir, encoding: "utf-8", timeout: 10000 });
  if (result.error) throw result.error;
  const r = JSON.parse(result.stdout.trim());
  assert(r.hasMyCustom, "custom allow should appear in translated settings");
  assert(r.hasWebSearch, "WebSearch should appear in translated settings");
  assert(r.hasCustomEcho, "custom-echo should appear in translated settings");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ testCustomAllowFlowsToTranslate passed");
}

function testNonStringAllowEntriesFiltered(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  fs.mkdirSync(path.join(tmpDir, "config"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "config", "guard-profile.json"), JSON.stringify({
    allow: ["Bash(ls:*)", 42, null, "WebSearch", true],
    deny: [],
  }));
  fs.writeFileSync(path.join(tmpDir, "config", "logging.json"), JSON.stringify({ level: "warn", directory: "logs", filename_prefix: "snail-shell", max_file_size_mb: 10 }));

  const testScript = `
    const { translateToClaudeSettings, DEFAULT_GUARD_PROFILE } = require(${JSON.stringify(path.join(process.cwd(), "dist", "src", "agent", "guard-config.js"))});
    const s = translateToClaudeSettings(DEFAULT_GUARD_PROFILE);
    process.stdout.write(JSON.stringify({
      allowLen: s.allow.length,
      hasLs: s.allow.includes("Bash(ls:*)"),
      hasWebSearch: s.allow.includes("WebSearch"),
    }));
  `;

  const result = spawnSync("node", ["-e", testScript], { cwd: tmpDir, encoding: "utf-8", timeout: 10000 });
  if (result.error) throw result.error;
  const r = JSON.parse(result.stdout.trim());
  assert(r.allowLen === 2, `should have 2 allow entries, got ${r.allowLen}`);
  assert(r.hasLs, "Bash(ls:*) should be kept");
  assert(r.hasWebSearch, "WebSearch should be kept");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ testNonStringAllowEntriesFiltered passed");
}

function testConfigProfileLoadsAllowDeny(): void {
  assert(Array.isArray(DEFAULT_GUARD_PROFILE.allow), "allow should be array");
  assert(Array.isArray(DEFAULT_GUARD_PROFILE.deny), "deny should be array");
  // 验证 deny 中包含关键安全条目
  const denyPatterns = DEFAULT_GUARD_PROFILE.deny;
  assert(denyPatterns.some((p) => p.includes("sqlite3")), "deny should include sqlite3 pattern");
  assert(denyPatterns.some((p) => p.includes("rm -rf")), "deny should include rm -rf pattern");
  console.log("✓ testConfigProfileLoadsAllowDeny passed");
}

function testInvalidConfigFieldsFallback(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  fs.mkdirSync(path.join(tmpDir, "config"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "config", "guard-profile.json"), JSON.stringify({
    allow: "not_an_array",
    deny: 42,
  }));
  fs.writeFileSync(path.join(tmpDir, "config", "logging.json"), JSON.stringify({ level: "warn", directory: "logs", filename_prefix: "snail-shell", max_file_size_mb: 10 }));

  const testScript = `
    const { DEFAULT_GUARD_PROFILE } = require(${JSON.stringify(path.join(process.cwd(), "dist", "src", "agent", "guard-config.js"))});
    process.stdout.write(JSON.stringify({
      allowLen: DEFAULT_GUARD_PROFILE.allow.length,
      denyLen: DEFAULT_GUARD_PROFILE.deny.length,
    }));
  `;

  const result = spawnSync("node", ["-e", testScript], { cwd: tmpDir, encoding: "utf-8", timeout: 10000 });
  if (result.error) throw result.error;
  const r = JSON.parse(result.stdout.trim());
  assert(r.allowLen === 0, "non-array allow should fallback to empty array");
  assert(r.denyLen === 0, "non-array deny should fallback to empty array");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ testInvalidConfigFieldsFallback passed");
}

// ──── runner ────

testDefaultProfileHasAllowDeny();
testResolveNullReturnsDefault();
testResolveUndefinedReturnsDefault();
testResolveEmptyObjectReturnsDefault();
testProjectAllowAppendsToDefault();
testProjectDenyAppendsToDefault();
testNonArrayFieldsFiltered();
testTranslateToClaudeSettings();
testCodexConfigDefaultsToWorkspaceWrite();
testCodexConfigRestrictiveDenyGoesReadOnly();
testWriteClaudeGuardSettingsCreatesFile();
testWriteClaudeGuardSettingsMergesExisting();
testWriteClaudeGuardSettingsDeduplicatesHooks();
testWriteClaudeGuardSettingsExtraAllow();
testWriteClaudeGuardSettingsPreservesMixedHooks();
testWriteCodexGuardConfigCreatesFile();
testWriteCodexGuardConfigMergeInsertBeforeSection();
testAllowDenyMissingDefaultsToEmpty();
testCustomAllowFlowsToTranslate();
testNonStringAllowEntriesFiltered();
testConfigProfileLoadsAllowDeny();
testInvalidConfigFieldsFallback();
console.log("\nguard-config tests passed");
