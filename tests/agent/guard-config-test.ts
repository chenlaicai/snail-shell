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
import { DEFAULT_GUARD_PROFILE, resolveGuardProfile, translateToClaudeSettings, translateToCodexConfigToml, translateToOpenCodePermission, writeClaudeGuardSettings, writeCodexGuardConfig, writeOpenCodeGuardConfig } from "../../src/agent/guard-config";

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
  /** denylist-only + allow-all 策略：allow 通配全部，deny 拦截已知危险 */
  assert(result.allow.length === 1 && result.allow[0] === "*", "allow should be [\"*\"] (allow-all)");
  assert(result.deny.length === 1, "deny should have 1 entry");
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
  /** denylist-only + allow-all 策略：allow 通配全部，只传递 deny 列表 */
  assert(Array.isArray(content.permissions.allow), "permissions.allow should exist");
  assert(content.permissions.allow.length === 1 && content.permissions.allow[0] === "*", "allow should be [\"*\"] (allow-all)");
  assert(content.permissions.deny.includes("Bash(rm -rf /:*)"), "deny should contain rm -rf");

  // 验证不写入 hooks（guard-bash.js 已移除，GuardProfile 只翻译为 permissions）
  assert(!content.hooks, "should not write hooks section");

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
  /** denylist-only + allow-all 策略：allow 通配全部，旧 allow 被覆盖 */
  assert(content.permissions.allow.length === 1 && content.permissions.allow[0] === "*", "allow should be [\"*\"] (allow-all)");
  assert(content.permissions.deny.includes("Bash(bad:*)"), "deny should contain new pattern");

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ testWriteClaudeGuardSettingsMergesExisting passed");
}

function testWriteClaudeGuardSettingsRemovesLegacyGuardBashHooks(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const claudeDir = path.join(tmpDir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  // 模拟旧版遗留的 hooks 配置（引用已删除的 guard-bash.js）
  fs.writeFileSync(path.join(claudeDir, "settings.local.json"), JSON.stringify({
    permissions: { allow: ["Bash(old:*)"], deny: [] },
    hooks: {
      PreToolUse: [
        { type: "command", command: "node .meta/hooks/guard-bash.js" },
      ],
    },
    customField: "keep-me",
  }));

  const guard = { allow: ["Bash(new:*)"], deny: ["Bash(bad:*)"] };
  writeClaudeGuardSettings(guard, tmpDir);

  const content = JSON.parse(fs.readFileSync(path.join(claudeDir, "settings.local.json"), "utf-8"));
  assert(!content.hooks, "legacy hooks referencing guard-bash.js should be removed");
  assert(content.customField === "keep-me", "non-Snail fields should still be preserved");
  assert(content.permissions.deny.includes("Bash(bad:*)"), "deny should contain new pattern");

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ testWriteClaudeGuardSettingsRemovesLegacyGuardBashHooks passed");
}

function testWriteClaudeGuardSettingsPreservesNonGuardBashHooks(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const claudeDir = path.join(tmpDir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  // hooks 中包含非 guard-bash 条目，应保留
  fs.writeFileSync(path.join(claudeDir, "settings.local.json"), JSON.stringify({
    hooks: {
      PreToolUse: [
        { type: "command", command: "node .meta/hooks/guard-bash.js" },
        { type: "command", command: "node .meta/hooks/custom-hook.js" },
      ],
    },
  }));

  const guard = { allow: [], deny: [] };
  writeClaudeGuardSettings(guard, tmpDir);

  const content = JSON.parse(fs.readFileSync(path.join(claudeDir, "settings.local.json"), "utf-8"));
  assert(content.hooks, "hooks section should remain when non-guard-bash entries exist");
  assert(content.hooks.PreToolUse.length === 1, "only guard-bash entry should be removed");
  assert(content.hooks.PreToolUse[0].command.includes("custom-hook"), "custom hook should be preserved");

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ testWriteClaudeGuardSettingsPreservesNonGuardBashHooks passed");
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
    deny: ["Bash(sqlite3:*)"],
  }));
  fs.writeFileSync(path.join(tmpDir, "config", "logging.json"), JSON.stringify({ level: "warn", directory: "logs", filename_prefix: "snail-shell", max_file_size_mb: 10 }));

  const testScript = `
    const { translateToClaudeSettings, DEFAULT_GUARD_PROFILE } = require(${JSON.stringify(path.join(process.cwd(), "dist", "src", "agent", "guard-config.js"))});
    const s = translateToClaudeSettings(DEFAULT_GUARD_PROFILE);
    process.stdout.write(JSON.stringify({
      /** denylist-only + allow-all：allow 通配全部，deny 从配置加载 */
      allowLen: s.allow.length,
      hasAllowWildcard: s.allow.includes("*"),
      denyLen: s.deny.length,
      hasDenySqlite: s.deny.includes("Bash(sqlite3:*)"),
    }));
  `;

  const result = spawnSync("node", ["-e", testScript], { cwd: tmpDir, encoding: "utf-8", timeout: 10000 });
  if (result.error) throw result.error;
  const r = JSON.parse(result.stdout.trim());
  assert(r.allowLen === 1, "allow should have 1 entry (wildcard)");
  assert(r.hasAllowWildcard, "allow should include \"*\"");
  assert(r.denyLen > 0, "deny should have entries from config");
  assert(r.hasDenySqlite, "deny should include sqlite3 from config");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ testCustomAllowFlowsToTranslate passed");
}

function testNonStringAllowEntriesFiltered(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  fs.mkdirSync(path.join(tmpDir, "config"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "config", "guard-profile.json"), JSON.stringify({
    allow: ["Bash(ls:*)", 42, null, "WebSearch", true],
    deny: ["Bash(sqlite3:*)", 123, null],
  }));
  fs.writeFileSync(path.join(tmpDir, "config", "logging.json"), JSON.stringify({ level: "warn", directory: "logs", filename_prefix: "snail-shell", max_file_size_mb: 10 }));

  const testScript = `
    const { translateToClaudeSettings, DEFAULT_GUARD_PROFILE } = require(${JSON.stringify(path.join(process.cwd(), "dist", "src", "agent", "guard-config.js"))});
    const s = translateToClaudeSettings(DEFAULT_GUARD_PROFILE);
    process.stdout.write(JSON.stringify({
      /** denylist-only + allow-all：allow 通配全部；deny 应过滤非字符串并保留有效条目 */
      allowLen: s.allow.length,
      hasAllowWildcard: s.allow.includes("*"),
      denyLen: s.deny.length,
      hasDenySqlite: s.deny.includes("Bash(sqlite3:*)"),
    }));
  `;

  const result = spawnSync("node", ["-e", testScript], { cwd: tmpDir, encoding: "utf-8", timeout: 10000 });
  if (result.error) throw result.error;
  const r = JSON.parse(result.stdout.trim());
  assert(r.allowLen === 1, "allow should have 1 entry (wildcard)");
  assert(r.hasAllowWildcard, "allow should include \"*\"");
  assert(r.denyLen === 1, `should have 1 deny entry (non-strings filtered), got ${r.denyLen}`);
  assert(r.hasDenySqlite, "Bash(sqlite3:*) should be kept in deny");
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

// ──── translateToOpenCodePermission ────

function testTranslateToOpenCodePermissionEmptyDeny(): void {
  const guard = { allow: ["Bash(node:*)"], deny: [] };
  const permission = translateToOpenCodePermission(guard);
  assert(permission["*"] === "allow", "default should be allow");
  assert(!permission["bash"], "empty deny should not create bash rules");
  console.log("✓ testTranslateToOpenCodePermissionEmptyDeny passed");
}

function testTranslateToOpenCodePermissionBashDeny(): void {
  const guard = { allow: [], deny: ["Bash(sqlite3:*)", "Bash(rm -rf /:*)"] };
  const permission = translateToOpenCodePermission(guard);
  assert(permission["*"] === "allow", "default should be allow");
  const bashRules = permission["bash"] as Record<string, string>;
  assert(bashRules["*"] === "allow", "bash default should be allow");
  // ACS "sqlite3:*" → OpenCode "sqlite3*" (通配符，无空格)
  assert(bashRules["sqlite3*"] === "deny", "sqlite3 should be denied");
  // ACS "rm -rf /:*" → OpenCode "rm -rf /*" (通配符，无空格)
  assert(bashRules["rm -rf /*"] === "deny", "rm -rf should be denied");
  console.log("✓ testTranslateToOpenCodePermissionBashDeny passed");
}

function testTranslateToOpenCodePermissionToolDeny(): void {
  const guard = { allow: [], deny: ["AskUserQuestion", "EnterPlanMode", "ExitPlanMode"] };
  const permission = translateToOpenCodePermission(guard);
  assert(permission["question"] === "deny", "AskUserQuestion should map to question deny");
  assert(!permission["enterplanmode"], "EnterPlanMode should be ignored");
  assert(!permission["exitplanmode"], "ExitPlanMode should be ignored");
  console.log("✓ testTranslateToOpenCodePermissionToolDeny passed");
}

function testTranslateToOpenCodePermissionMixed(): void {
  const guard = {
    allow: ["Bash(node:*)"],
    deny: ["Bash(sqlite3:*)", "Bash(chmod 777:*)", "AskUserQuestion"],
  };
  const permission = translateToOpenCodePermission(guard);
  assert(permission["*"] === "allow", "default should be allow");
  const bashRules = permission["bash"] as Record<string, string>;
  // ACS "sqlite3:*" → OpenCode "sqlite3*" (通配符，无空格)
  assert(bashRules["sqlite3*"] === "deny", "sqlite3 should be denied");
  // ACS "chmod 777:*" → OpenCode "chmod 777*" (通配符，无空格)
  assert(bashRules["chmod 777*"] === "deny", "chmod 777 should be denied");
  assert(permission["question"] === "deny", "question should be denied");
  console.log("✓ testTranslateToOpenCodePermissionMixed passed");
}

// ──── writeOpenCodeGuardConfig ────

function testWriteOpenCodeGuardConfigCreatesFile(): void {
  // 使用临时 HOME 目录避免污染真实配置
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const originalHome = process.env.HOME;
  process.env.HOME = tmpDir;

  try {
    const guard = { allow: ["Bash(node:*)"], deny: ["Bash(sqlite3:*)"] };
    writeOpenCodeGuardConfig(guard);

    const configPath = path.join(tmpDir, ".config", "opencode", "opencode.jsonc");
    assert(fs.existsSync(configPath), "opencode.jsonc should be created");
    const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    assert(content.$schema === "https://opencode.ai/config.json", "should have $schema");
    assert(content.permission["*"] === "allow", "default should be allow");
    const bashRules = content.permission["bash"] as Record<string, string>;
    // ACS "sqlite3:*" → OpenCode "sqlite3*" (通配符，无空格)
    assert(bashRules["sqlite3*"] === "deny", "sqlite3 should be denied");

    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log("✓ testWriteOpenCodeGuardConfigCreatesFile passed");
  } finally {
    process.env.HOME = originalHome;
  }
}

function testWriteOpenCodeGuardConfigMergesExisting(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const originalHome = process.env.HOME;
  process.env.HOME = tmpDir;

  try {
    const configDir = path.join(tmpDir, ".config", "opencode");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "opencode.jsonc"), JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      model: "anthropic/claude-sonnet-4-5",
      provider: { myprovider: { name: "test" } },
    }));

    const guard = { allow: [], deny: ["Bash(rm -rf /:*)"] };
    writeOpenCodeGuardConfig(guard);

    const content = JSON.parse(fs.readFileSync(path.join(configDir, "opencode.jsonc"), "utf-8"));
    assert(content.model === "anthropic/claude-sonnet-4-5", "existing model should be preserved");
    assert(content.provider.myprovider.name === "test", "existing provider should be preserved");
    assert(content.permission["*"] === "allow", "permission should be added");
    const bashRules = content.permission["bash"] as Record<string, string>;
    assert(bashRules["rm -rf /*"] === "deny", "rm -rf should be denied");

    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log("✓ testWriteOpenCodeGuardConfigMergesExisting passed");
  } finally {
    process.env.HOME = originalHome;
  }
}

// ──── JSONC 解析测试（通过 writeOpenCodeGuardConfig 验证 removeJsonComments） ────

function testWriteOpenCodeGuardConfigParsesJsoncWithLineComments(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const originalHome = process.env.HOME;
  process.env.HOME = tmpDir;

  try {
    const configDir = path.join(tmpDir, ".config", "opencode");
    fs.mkdirSync(configDir, { recursive: true });
    // 包含 // 行注释的 JSONC
    fs.writeFileSync(path.join(configDir, "opencode.jsonc"), [
      '{',
      '  // 这是行注释',
      '  "model": "anthropic/claude-sonnet-4-5",',
      '  "provider": { "test": { "name": "test" } }, // 行尾注释',
      '}',
    ].join("\n"));

    const guard = { allow: [], deny: ["Bash(sqlite3:*)"] };
    writeOpenCodeGuardConfig(guard);

    const content = JSON.parse(fs.readFileSync(path.join(configDir, "opencode.jsonc"), "utf-8"));
    assert(content.model === "anthropic/claude-sonnet-4-5", "model should be preserved after line comment removal");
    assert(content.permission["*"] === "allow", "permission should be added");

    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log("✓ testWriteOpenCodeGuardConfigParsesJsoncWithLineComments passed");
  } finally {
    process.env.HOME = originalHome;
  }
}

function testWriteOpenCodeGuardConfigParsesJsoncWithBlockComments(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const originalHome = process.env.HOME;
  process.env.HOME = tmpDir;

  try {
    const configDir = path.join(tmpDir, ".config", "opencode");
    fs.mkdirSync(configDir, { recursive: true });
    // 包含 /* */ 块注释的 JSONC
    fs.writeFileSync(path.join(configDir, "opencode.jsonc"), [
      '{',
      '  /* 这是块注释 */',
      '  "model": "anthropic/claude-sonnet-4-5",',
      '  "provider": {',
      '    /* 多行',
      '       块注释 */',
      '    "test": { "name": "test" }',
      '  }',
      '}',
    ].join("\n"));

    const guard = { allow: [], deny: ["Bash(sqlite3:*)"] };
    writeOpenCodeGuardConfig(guard);

    const content = JSON.parse(fs.readFileSync(path.join(configDir, "opencode.jsonc"), "utf-8"));
    assert(content.model === "anthropic/claude-sonnet-4-5", "model should be preserved after block comment removal");
    assert(content.permission["*"] === "allow", "permission should be added");

    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log("✓ testWriteOpenCodeGuardConfigParsesJsoncWithBlockComments passed");
  } finally {
    process.env.HOME = originalHome;
  }
}

function testWriteOpenCodeGuardConfigParsesJsoncWithStringContainingSlashes(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const originalHome = process.env.HOME;
  process.env.HOME = tmpDir;

  try {
    const configDir = path.join(tmpDir, ".config", "opencode");
    fs.mkdirSync(configDir, { recursive: true });
    // 字符串内包含 "//" 和 "/*"，不应被误判为注释
    fs.writeFileSync(path.join(configDir, "opencode.jsonc"), [
      '{',
      '  "model": "anthropic/claude-sonnet-4-5",',
      '  "provider": {',
      '    "test": {',
      '      "url": "https://opencode.ai/config.json",',
      '      "pattern": "/* not a comment */"',
      '    }',
      '  }',
      '}',
    ].join("\n"));

    const guard = { allow: [], deny: ["Bash(sqlite3:*)"] };
    writeOpenCodeGuardConfig(guard);

    const content = JSON.parse(fs.readFileSync(path.join(configDir, "opencode.jsonc"), "utf-8"));
    assert(content.provider.test.url === "https://opencode.ai/config.json", "URL with // should be preserved");
    assert(content.provider.test.pattern === "/* not a comment */", "string containing /* */ should be preserved");
    assert(content.permission["*"] === "allow", "permission should be added");

    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log("✓ testWriteOpenCodeGuardConfigParsesJsoncWithStringContainingSlashes passed");
  } finally {
    process.env.HOME = originalHome;
  }
}

function testWriteOpenCodeGuardConfigHandlesEmptyJsonc(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const originalHome = process.env.HOME;
  process.env.HOME = tmpDir;

  try {
    const configDir = path.join(tmpDir, ".config", "opencode");
    fs.mkdirSync(configDir, { recursive: true });
    // 空 JSONC 文件（只有注释）
    fs.writeFileSync(path.join(configDir, "opencode.jsonc"), [
      '// 只有注释的文件',
      '/* 块注释 */',
    ].join("\n"));

    const guard = { allow: [], deny: ["Bash(sqlite3:*)"] };
    writeOpenCodeGuardConfig(guard);

    const content = JSON.parse(fs.readFileSync(path.join(configDir, "opencode.jsonc"), "utf-8"));
    assert(content.permission["*"] === "allow", "permission should be added even from empty JSONC");

    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log("✓ testWriteOpenCodeGuardConfigHandlesEmptyJsonc passed");
  } finally {
    process.env.HOME = originalHome;
  }
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
testWriteClaudeGuardSettingsRemovesLegacyGuardBashHooks();
testWriteClaudeGuardSettingsPreservesNonGuardBashHooks();
testWriteClaudeGuardSettingsExtraAllow();
testWriteCodexGuardConfigCreatesFile();
testWriteCodexGuardConfigMergeInsertBeforeSection();
testAllowDenyMissingDefaultsToEmpty();
testCustomAllowFlowsToTranslate();
testNonStringAllowEntriesFiltered();
testConfigProfileLoadsAllowDeny();
testInvalidConfigFieldsFallback();
testTranslateToOpenCodePermissionEmptyDeny();
testTranslateToOpenCodePermissionBashDeny();
testTranslateToOpenCodePermissionToolDeny();
testTranslateToOpenCodePermissionMixed();
testWriteOpenCodeGuardConfigCreatesFile();
testWriteOpenCodeGuardConfigMergesExisting();
testWriteOpenCodeGuardConfigParsesJsoncWithLineComments();
testWriteOpenCodeGuardConfigParsesJsoncWithBlockComments();
testWriteOpenCodeGuardConfigParsesJsoncWithStringContainingSlashes();
testWriteOpenCodeGuardConfigHandlesEmptyJsonc();
console.log("\nguard-config tests passed");
