/**
 * guard-config.ts 单元测试（扁平模型版本）
 *
 * 覆盖：
 * - DEFAULT_GUARD_PROFILE 从 config/guard-profile.json 加载（allow/deny 数组）
 * - resolveGuardProfile 的合并行为（null、追加、非法回退）
 * - buildDisallowedToolsArgs / translateToCodexConfigToml 翻译
 * - writeCodexGuardConfig 合并写入
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawnSync } from "child_process";
import { DEFAULT_GUARD_PROFILE, resolveGuardProfile, buildDisallowedToolsArgs, translateToCodexConfigToml, translateToOpenCodePermission, writeCodexGuardConfig, writeOpenCodeGuardConfig } from "../../src/agent/guard-config";

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

function testWorkspaceAllowAppendsToDefault(): void {
  const resolved = resolveGuardProfile({ allow: ["Bash(my-custom:*)"], deny: [] });
  assert(resolved.allow.includes("Bash(my-custom:*)"), "workspace allow should be appended");
  assert(resolved.allow[resolved.allow.length - 1] === "Bash(my-custom:*)", "workspace allow should be last");
  console.log("✓ testWorkspaceAllowAppendsToDefault passed");
}

function testWorkspaceDenyAppendsToDefault(): void {
  const resolved = resolveGuardProfile({ deny: ["Bash(dangerous:*)"], allow: [] });
  assert(resolved.deny.includes("Bash(dangerous:*)"), "workspace deny should be appended");
  console.log("✓ testWorkspaceDenyAppendsToDefault passed");
}

function testNonArrayFieldsFiltered(): void {
  const resolved = resolveGuardProfile({ allow: ["Bash(ok:*)", 42, null, true], deny: [null, undefined] });
  // workspace allow/deny 追加到 default 之上，非字符串被过滤
  assert(resolved.allow.includes("Bash(ok:*)"), "valid string should be kept in allow");
  assert(!resolved.allow.includes(42 as any), "non-string should be filtered from allow");
  assert(resolved.deny.length === DEFAULT_GUARD_PROFILE.deny.length, "empty deny workspace array should not add entries");
  console.log("✓ testNonArrayFieldsFiltered passed");
}

// ──── buildDisallowedToolsArgs ────

function testBuildDisallowedToolsArgsEmpty(): void {
  const guard = { allow: ["Bash(node:*)"], deny: [] };
  const args = buildDisallowedToolsArgs(guard);
  assert(args.length === 0, "empty deny should return empty args");
  console.log("✓ testBuildDisallowedToolsArgsEmpty passed");
}

function testBuildDisallowedToolsArgsSingle(): void {
  const guard = { allow: [], deny: ["Bash(sqlite3:*)"] };
  const args = buildDisallowedToolsArgs(guard);
  assert(args[0] === "--disallowedTools", "first arg should be --disallowedTools");
  assert(args[1] === "Bash(sqlite3:*)", "second arg should be the deny pattern");
  assert(args.length === 2, "should have exactly 2 args");
  console.log("✓ testBuildDisallowedToolsArgsSingle passed");
}

function testBuildDisallowedToolsArgsMultiple(): void {
  const guard = { allow: [], deny: ["Bash(sqlite3:*)", "Bash(rm -rf /:*)", "Bash(git stash:*)"] };
  const args = buildDisallowedToolsArgs(guard);
  assert(args[0] === "--disallowedTools", "first arg should be --disallowedTools");
  assert(args.length === 4, "should have 4 args (flag + 3 patterns)");
  assert(args.includes("Bash(sqlite3:*)"), "should include sqlite3");
  assert(args.includes("Bash(rm -rf /:*)"), "should include rm -rf");
  assert(args.includes("Bash(git stash:*)"), "should include git stash");
  console.log("✓ testBuildDisallowedToolsArgsMultiple passed");
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
testWorkspaceAllowAppendsToDefault();
testWorkspaceDenyAppendsToDefault();
testNonArrayFieldsFiltered();
testBuildDisallowedToolsArgsEmpty();
testBuildDisallowedToolsArgsSingle();
testBuildDisallowedToolsArgsMultiple();
testCodexConfigDefaultsToWorkspaceWrite();
testCodexConfigRestrictiveDenyGoesReadOnly();
testWriteCodexGuardConfigCreatesFile();
testWriteCodexGuardConfigMergeInsertBeforeSection();
testAllowDenyMissingDefaultsToEmpty();
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
