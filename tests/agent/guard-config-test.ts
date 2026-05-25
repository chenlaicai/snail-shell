/**
 * guard-config.ts 单元测试
 *
 * 覆盖：
 * - DEFAULT_GUARD_PROFILE 结构完整性
 * - resolveGuardProfile 的合并行为（null、部分覆盖、非法覆盖）
 * - translateToClaudeSettings / translateToCodexSettings / translateToOpenCodeSettings 翻译
 * - writeClaudeGuardSettings 的合并行为（保留已有非托管字段）
 * - writeCodexGuardSettings / writeOpenCodeGuardSettings 写入
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  DEFAULT_GUARD_PROFILE,
  resolveGuardProfile,
  translateToClaudeSettings,
  translateToCodexConfigToml,
  writeClaudeGuardSettings,
  writeCodexGuardConfig,
} from "../../src/agent/guard-config";
import type { GuardProfile } from "../../src/agent/capability";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// ──── DEFAULT_GUARD_PROFILE 结构 ────

function testDefaultGuardProfileHasAllDomains(): void {
  const g = DEFAULT_GUARD_PROFILE;
  assert(typeof g.database === "object" && g.database !== null, "database domain must exist");
  assert(typeof g.filesystem === "object" && g.filesystem !== null, "filesystem domain must exist");
  assert(typeof g.network === "object" && g.network !== null, "network domain must exist");
  assert(typeof g.git === "object" && g.git !== null, "git domain must exist");
  console.log("✓ testDefaultGuardProfileHasAllDomains passed");
}

function testDatabaseDefaultsToDeny(): void {
  assert(DEFAULT_GUARD_PROFILE.database.mode === "deny", "database should default to deny");
  console.log("✓ testDatabaseDefaultsToDeny passed");
}

function testFilesystemDefaultsToAllowWithProtectedPaths(): void {
  assert(DEFAULT_GUARD_PROFILE.filesystem.mode === "allow", "filesystem should default to allow");
  assert(DEFAULT_GUARD_PROFILE.filesystem.protectedPaths!.length > 0, "filesystem should have protected paths");
  console.log("✓ testFilesystemDefaultsToAllowWithProtectedPaths passed");
}

// ──── resolveGuardProfile ────

function testResolveGuardProfileNullReturnsDefault(): void {
  const resolved = resolveGuardProfile(null);
  assert(resolved === DEFAULT_GUARD_PROFILE, "null input should return default");
  console.log("✓ testResolveGuardProfileNullReturnsDefault passed");
}

function testResolveGuardProfileUndefinedReturnsDefault(): void {
  const resolved = resolveGuardProfile(undefined);
  assert(resolved === DEFAULT_GUARD_PROFILE, "undefined input should return default");
  console.log("✓ testResolveGuardProfileUndefinedReturnsDefault passed");
}

function testResolveGuardProfileEmptyObjectReturnsDefault(): void {
  const resolved = resolveGuardProfile({});
  assert(resolved.database.mode === DEFAULT_GUARD_PROFILE.database.mode, "empty object should use default database mode");
  console.log("✓ testResolveGuardProfileEmptyObjectReturnsDefault passed");
}

function testResolveGuardProfilePartialOverride(): void {
  // 只覆盖 database.mode，其他领域应保持默认
  const partial: Record<string, unknown> = {
    database: { mode: "ask" },
  };
  const resolved = resolveGuardProfile(partial);
  assert(resolved.database.mode === "ask", "overridden mode should be 'ask'");
  assert(resolved.filesystem.mode === DEFAULT_GUARD_PROFILE.filesystem.mode, "filesystem should keep default");
  assert(resolved.network.mode === DEFAULT_GUARD_PROFILE.network.mode, "network should keep default");
  assert(resolved.git.mode === DEFAULT_GUARD_PROFILE.git.mode, "git should keep default");
  console.log("✓ testResolveGuardProfilePartialOverride passed");
}

function testResolveGuardProfileInvalidOverrideFallsBack(): void {
  // 非法值应该回退到默认
  const invalid: Record<string, unknown> = {
    database: "not an object",
  };
  const resolved = resolveGuardProfile(invalid);
  assert(resolved.database.mode === DEFAULT_GUARD_PROFILE.database.mode, "invalid database should fallback");
  console.log("✓ testResolveGuardProfileInvalidOverrideFallsBack passed");
}

function testResolveGuardProfileInvalidModeFallsBack(): void {
  const invalidMode: Record<string, unknown> = {
    database: { mode: "invalid_mode" },
  };
  const resolved = resolveGuardProfile(invalidMode);
  assert(resolved.database.mode === DEFAULT_GUARD_PROFILE.database.mode, "invalid mode should fallback to default");
  console.log("✓ testResolveGuardProfileInvalidModeFallsBack passed");
}

// ──── translateToClaudeSettings ────

function testTranslateDatabaseDenyAddsDenyEntries(): void {
  const guard: GuardProfile = {
    ...DEFAULT_GUARD_PROFILE,
    database: { ...DEFAULT_GUARD_PROFILE.database, mode: "deny" },
  };
  const settings = translateToClaudeSettings(guard);
  const deny = settings.deny;
  assert(deny.some((d) => d.includes("sqlite3")), "deny should include sqlite3");
  assert(deny.some((d) => d.includes("psql")), "deny should include psql");
  assert(deny.some((d) => d.includes("mysql")), "deny should include mysql");
  console.log("✓ testTranslateDatabaseDenyAddsDenyEntries passed");
}

function testTranslateDatabaseAllowSkipsDenyAndAddsToAllow(): void {
  const guard: GuardProfile = {
    ...DEFAULT_GUARD_PROFILE,
    database: { ...DEFAULT_GUARD_PROFILE.database, mode: "allow" },
  };
  const settings = translateToClaudeSettings(guard);

  // deny 列表不应含数据库 CLI
  const hasDbDeny = settings.deny.some((d) => d.includes("sqlite3"));
  assert(!hasDbDeny, "allow mode should not add database deny entries");

  // allow 列表应含数据库 CLI
  assert(settings.allow.some((a) => a.includes("sqlite3")), "allow mode should add sqlite3 to allow list");
  assert(settings.allow.some((a) => a.includes("psql")), "allow mode should add psql to allow list");
  assert(settings.allow.some((a) => a.includes("mysql")), "allow mode should add mysql to allow list");
  console.log("✓ testTranslateDatabaseAllowSkipsDenyAndAddsToAllow passed");
}

function testTranslateDatabaseAllowDoesNotAddDbToAllowForDenyMode(): void {
  // deny 模式（默认）allow 列表不应含数据库 CLI
  const settings = translateToClaudeSettings(DEFAULT_GUARD_PROFILE);
  const hasDbAllow = settings.allow.some((a) => a.includes("sqlite3"));
  assert(!hasDbAllow, "deny mode should not add sqlite3 to allow list");
  console.log("✓ testTranslateDatabaseAllowDoesNotAddDbToAllowForDenyMode passed");
}

function testTranslateIncludesAllowList(): void {
  const settings = translateToClaudeSettings(DEFAULT_GUARD_PROFILE);
  assert(settings.allow.length > 0, "allow list should not be empty");
  assert(settings.allow.includes("WebSearch"), "allow list should include WebSearch");
  console.log("✓ testTranslateIncludesAllowList passed");
}

function testTranslateFilesystemDenyPatterns(): void {
  const guard: GuardProfile = {
    ...DEFAULT_GUARD_PROFILE,
    filesystem: { ...DEFAULT_GUARD_PROFILE.filesystem, denyPatterns: ["chmod 777", "rm -rf /"] },
  };
  const settings = translateToClaudeSettings(guard);
  assert(settings.deny.some((d) => d.includes("chmod 777")), "deny should include chmod 777");
  assert(settings.deny.some((d) => d.includes("rm -rf /")), "deny should include rm -rf /");
  console.log("✓ testTranslateFilesystemDenyPatterns passed");
}

function testTranslateGitDenyPatterns(): void {
  const guard: GuardProfile = {
    ...DEFAULT_GUARD_PROFILE,
    git: { ...DEFAULT_GUARD_PROFILE.git, denyPatterns: ["push --force main", "reset --hard"] },
  };
  const settings = translateToClaudeSettings(guard);
  assert(settings.deny.some((d) => d.includes("push --force main")), "deny should include push --force main");
  assert(settings.deny.some((d) => d.includes("reset --hard")), "deny should include reset --hard");
  console.log("✓ testTranslateGitDenyPatterns passed");
}

// ──── writeClaudeGuardSettings 合并行为 ────

function testWriteGuardSettingsMergesExistingSettings(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const claudeDir = path.join(tmpDir, ".claude");
  fs.mkdirSync(claudeDir);
  const settingsPath = path.join(claudeDir, "settings.local.json");

  // 写入已有 settings，包含非 Snail Shell 管理的字段
  const existingSettings = {
    mcpServers: { custom: { command: "my-mcp", args: [] } },
    model: "claude-sonnet-4-6",
    hooks: {
      PostToolUse: [{ matcher: "", command: "my-custom-hook" }],
      PreToolUse: [
        { matcher: "Edit", command: "my-edit-hook" },
      ],
    },
    customKey: "should-survive",
  };
  fs.writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));

  // 执行 writeClaudeGuardSettings（需要 cwd 指向 tmpDir）
  const originalCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    writeClaudeGuardSettings(DEFAULT_GUARD_PROFILE);

    const written = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));

    // Snail Shell 托管的字段应被覆盖
    assert(typeof written.permissions === "object", "permissions should exist");
    assert(written.permissions.allow.length > 0, "allow list should be populated");

    // 非 Snail Shell 托管的字段应保留
    assert(written.mcpServers?.custom?.command === "my-mcp", "custom MCP should survive");
    assert(written.model === "claude-sonnet-4-6", "model setting should survive");
    assert(written.customKey === "should-survive", "custom key should survive");

    // PostToolUse hooks 应保留
    assert(Array.isArray(written.hooks?.PostToolUse), "PostToolUse should survive");
    assert(written.hooks.PostToolUse[0].command === "my-custom-hook", "custom PostToolUse hook should survive");

    // 非 Snail Shell 的 PreToolUse hook 应保留
    const preToolUse = written.hooks?.PreToolUse as Array<Record<string, unknown>>;
    const myHook = preToolUse.find((h) => h.command === "my-edit-hook");
    assert(myHook !== undefined, "custom PreToolUse hook should survive");

    // Snail Shell 的 guard-bash hook 应存在
    const guardHook = preToolUse.find((h) => h.command === "node .meta/hooks/guard-bash.js");
    assert(guardHook !== undefined, "guard-bash hook should be added");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log("✓ testWriteGuardSettingsMergesExistingSettings passed");
}

function testWriteGuardSettingsCreatesNewWhenMissing(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const settingsPath = path.join(tmpDir, ".claude", "settings.local.json");

  const originalCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    writeClaudeGuardSettings(DEFAULT_GUARD_PROFILE);

    const written = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    assert(typeof written.permissions === "object", "permissions should exist");
    assert(written.permissions.allow.length > 0, "allow list should be populated");

    const preToolUse = written.hooks?.PreToolUse as Array<Record<string, unknown>>;
    const guardHook = preToolUse?.find((h) => h.command === "node .meta/hooks/guard-bash.js");
    assert(guardHook !== undefined, "guard-bash hook should exist");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log("✓ testWriteGuardSettingsCreatesNewWhenMissing passed");
}

function testWriteGuardSettingsAlsoWritesGuardProfileJson(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const guardProfilePath = path.join(tmpDir, ".claude", "guard-profile.json");

  const originalCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    writeClaudeGuardSettings(DEFAULT_GUARD_PROFILE);

    // guard-profile.json 应被写入，供 guard-bash.js hook 读取
    assert(fs.existsSync(guardProfilePath), "guard-profile.json should be created");
    const profile = JSON.parse(fs.readFileSync(guardProfilePath, "utf-8"));
    assert(typeof profile.database === "object", "guard-profile.json should have database domain");
    assert(profile.database.mode === DEFAULT_GUARD_PROFILE.database.mode, "database.mode should match default");
    assert(typeof profile.filesystem === "object", "guard-profile.json should have filesystem domain");
    assert(typeof profile.network === "object", "guard-profile.json should have network domain");
    assert(typeof profile.git === "object", "guard-profile.json should have git domain");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log("✓ testWriteGuardSettingsAlsoWritesGuardProfileJson passed");
}

// ──── Codex config.toml 翻译 ────

function testTranslateCodexConfigTomlWorkspaceWrite(): void {
  const toml = translateToCodexConfigToml(DEFAULT_GUARD_PROFILE);
  assert(toml.includes('sandbox_mode = "workspace-write"'), "default filesystem=allow → workspace-write");
  console.log("✓ testTranslateCodexConfigTomlWorkspaceWrite passed");
}

function testTranslateCodexConfigTomlReadOnly(): void {
  const guard: GuardProfile = {
    ...DEFAULT_GUARD_PROFILE,
    filesystem: { ...DEFAULT_GUARD_PROFILE.filesystem, mode: "deny" },
  };
  const toml = translateToCodexConfigToml(guard);
  assert(toml.includes('sandbox_mode = "read-only"'), "filesystem=deny → read-only");
  console.log("✓ testTranslateCodexConfigTomlReadOnly passed");
}

function testWriteCodexGuardConfig(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const codexConfigPath = path.join(tmpDir, ".codex", "config.toml");
  const guard: GuardProfile = {
    ...DEFAULT_GUARD_PROFILE,
    filesystem: { ...DEFAULT_GUARD_PROFILE.filesystem, mode: "deny" },
  };

  const originalCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    writeCodexGuardConfig(guard);

    assert(fs.existsSync(codexConfigPath), ".codex/config.toml should be created");
    const written = fs.readFileSync(codexConfigPath, "utf-8");
    assert(written.includes('sandbox_mode = "read-only"'), "config.toml should have read-only sandbox");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log("✓ testWriteCodexGuardConfig passed");
}

// OpenCode: 无 per-project 配置入口（全局配置 ~/.config/opencode/opencode.jsonc）。
// 安全机制：移除 --dangerously-skip-permissions 恢复默认权限模式（在 opencode.ts 中完成）。
// 后续支持 per-project 配置后可补充测试。

// ──── 运行 ────

testDefaultGuardProfileHasAllDomains();
testDatabaseDefaultsToDeny();
testFilesystemDefaultsToAllowWithProtectedPaths();
testResolveGuardProfileNullReturnsDefault();
testResolveGuardProfileUndefinedReturnsDefault();
testResolveGuardProfileEmptyObjectReturnsDefault();
testResolveGuardProfilePartialOverride();
testResolveGuardProfileInvalidOverrideFallsBack();
testResolveGuardProfileInvalidModeFallsBack();
testTranslateDatabaseDenyAddsDenyEntries();
testTranslateDatabaseAllowSkipsDenyAndAddsToAllow();
testTranslateDatabaseAllowDoesNotAddDbToAllowForDenyMode();
testTranslateIncludesAllowList();
testTranslateFilesystemDenyPatterns();
testTranslateGitDenyPatterns();
testWriteGuardSettingsMergesExistingSettings();
testWriteGuardSettingsCreatesNewWhenMissing();
testWriteGuardSettingsAlsoWritesGuardProfileJson();
testTranslateCodexConfigTomlWorkspaceWrite();
testTranslateCodexConfigTomlReadOnly();
testWriteCodexGuardConfig();
console.log("\nguard-config tests passed");
