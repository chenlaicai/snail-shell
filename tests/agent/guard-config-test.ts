/**
 * guard-config.ts 单元测试
 *
 * 覆盖：
 * - DEFAULT_GUARD_PROFILE 从 config/guard-profile.json 加载（字段级安全合并，含 allowTools）
 * - resolveGuardProfile 的合并行为（null、部分覆盖、非法覆盖、project 覆盖优先级、allowTools 合并）
 * - translateToClaudeSettings / translateToCodexConfigToml 翻译
 * - writeClaudeGuardSettings / writeCodexGuardConfig 合并写入
 */

import { spawnSync } from "child_process";
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

    // Snail Shell 的 guard-bash hook 应存在（绝对路径）
    const guardHook = preToolUse.find((h) => typeof h.command === "string" && h.command.includes("guard-bash.js"));
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
    const guardHook = preToolUse?.find((h) => typeof h.command === "string" && h.command.includes("guard-bash.js"));
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

function testWriteCodexGuardConfigMerge(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const codexDir = path.join(tmpDir, ".codex");
  fs.mkdirSync(codexDir, { recursive: true });
  const codexConfigPath = path.join(codexDir, "config.toml");

  // 写入已有的 config.toml（模拟用户手动配置）
  fs.writeFileSync(codexConfigPath, [
    `# user custom settings`,
    `model = "claude-opus-4"`,
    `sandbox_mode = "workspace-write"`,
    `# end user settings`,
  ].join("\n"), "utf-8");

  const originalCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    // 写入 GuardProfile 配置（filesystem deny → read-only）
    writeCodexGuardConfig({
      ...DEFAULT_GUARD_PROFILE,
      filesystem: { ...DEFAULT_GUARD_PROFILE.filesystem, mode: "deny" },
    });

    const merged = fs.readFileSync(codexConfigPath, "utf-8");
    assert(merged.includes('sandbox_mode = "read-only"'), "sandbox_mode should be updated");
    assert(merged.includes('model = "claude-opus-4"'), "user model setting should be preserved");
    assert(merged.includes("# user custom settings"), "user comments should be preserved");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log("✓ testWriteCodexGuardConfigMerge passed");
}

/**
 * config.toml 中 [section] 内的 sandbox_mode 不应被合并逻辑误改。
 */
function testWriteCodexGuardConfigMergeDoesNotTouchSectionKey(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const codexDir = path.join(tmpDir, ".codex");
  fs.mkdirSync(codexDir, { recursive: true });
  const codexConfigPath = path.join(codexDir, "config.toml");

  fs.writeFileSync(codexConfigPath, [
    `sandbox_mode = "workspace-write"`,
    ``,
    `[profile.staging]`,
    `model = "claude-opus-4"`,
    `sandbox_mode = "danger-full-access"`,
  ].join("\n"), "utf-8");

  const originalCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    writeCodexGuardConfig({
      ...DEFAULT_GUARD_PROFILE,
      filesystem: { ...DEFAULT_GUARD_PROFILE.filesystem, mode: "deny" },
    });

    const merged = fs.readFileSync(codexConfigPath, "utf-8");
    // 顶层 sandbox_mode 应被更新
    assert(/^sandbox_mode = "read-only"$/m.test(merged), "top-level sandbox_mode should be updated to read-only");
    // [profile.staging] 内的 sandbox_mode 不应被改动
    const sectionMatch = merged.match(/\[profile\.staging\][\s\S]*$/);
    assert(sectionMatch !== null, "profile.staging section should exist");
    assert(sectionMatch![0].includes('sandbox_mode = "danger-full-access"'), "section sandbox_mode must NOT be touched");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log("✓ testWriteCodexGuardConfigMergeDoesNotTouchSectionKey passed");
}

/**
 * 顶层无 sandbox_mode、仅 section 内有 → 新 key 插入第一个 [section] 之前，
 * 而非追加到文件末尾（末尾行属于最后一个 section）。
 */
function testWriteCodexGuardConfigMergeInsertBeforeSection(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  const codexDir = path.join(tmpDir, ".codex");
  fs.mkdirSync(codexDir, { recursive: true });
  const codexConfigPath = path.join(codexDir, "config.toml");

  fs.writeFileSync(codexConfigPath, [
    `model = "claude-opus-4"`,
    ``,
    `[profile.staging]`,
    `sandbox_mode = "danger-full-access"`,
  ].join("\n"), "utf-8");

  const originalCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    writeCodexGuardConfig({
      ...DEFAULT_GUARD_PROFILE,
      filesystem: { ...DEFAULT_GUARD_PROFILE.filesystem, mode: "deny" },
    });

    const merged = fs.readFileSync(codexConfigPath, "utf-8");
    const lines = merged.split("\n");
    const sectionIdx = lines.findIndex((l: string) => l.startsWith("[profile.staging]"));
    const newSbxIdx = lines.findIndex((l: string) => l.startsWith("sandbox_mode"));
    // 新 sandbox_mode 应在 [section] 之前
    assert(newSbxIdx < sectionIdx, "new sandbox_mode must be inserted BEFORE [profile.staging], not appended at end");
    assert(lines[newSbxIdx] === 'sandbox_mode = "read-only"', "new sandbox_mode should be read-only");
    // section 内原有值不变
    assert(merged.includes('sandbox_mode = "danger-full-access"'), "section sandbox_mode must NOT be touched");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log("✓ testWriteCodexGuardConfigMergeInsertBeforeSection passed");
}

// ──── guard-profile.json allowTools ────

/**
 * guard-profile.json 缺失 allowTools 字段时应回退空数组（不报错）。
 */
function testAllowToolsMissingDefaultsToEmpty(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  fs.mkdirSync(path.join(tmpDir, "config"), { recursive: true });
  // guard-profile.json 无 allowTools 字段
  fs.writeFileSync(path.join(tmpDir, "config", "guard-profile.json"), JSON.stringify({ database: {}, filesystem: {}, network: {}, git: {} }));
  fs.writeFileSync(path.join(tmpDir, "config", "logging.json"), JSON.stringify({ level: "warn", directory: "logs", filename_prefix: "snail-shell", max_file_size_mb: 10 }));

  const testScript = `
    const { DEFAULT_GUARD_PROFILE } = require(${JSON.stringify(path.join(process.cwd(), "dist", "src", "agent", "guard-config.js"))});
    process.stdout.write(JSON.stringify({
      allowToolsLen: Array.isArray(DEFAULT_GUARD_PROFILE.allowTools) ? DEFAULT_GUARD_PROFILE.allowTools.length : -1,
    }));
  `;

  const result = spawnSync("node", ["-e", testScript], { cwd: tmpDir, encoding: "utf-8", timeout: 10000 });
  if (result.error) throw result.error;
  const r = JSON.parse(result.stdout.trim());
  assert(r.allowToolsLen >= 0, "missing allowTools should default to empty array");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ testAllowToolsMissingDefaultsToEmpty passed");
}

/**
 * guard-profile.json allowTools 条目应出现在 translateToClaudeSettings 的 allow 列表中。
 */
function testAllowToolsFlowsToTranslate(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  fs.mkdirSync(path.join(tmpDir, "config"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "config", "guard-profile.json"), JSON.stringify({
    database: {}, filesystem: {}, network: {}, git: {},
    allowTools: ["Bash(my-custom-tool:*)", "WebSearch", "Bash(custom-echo:*)"],
  }));
  fs.writeFileSync(path.join(tmpDir, "config", "logging.json"), JSON.stringify({ level: "warn", directory: "logs", filename_prefix: "snail-shell", max_file_size_mb: 10 }));

  const testScript = `
    const { translateToClaudeSettings, DEFAULT_GUARD_PROFILE } = require(${JSON.stringify(path.join(process.cwd(), "dist", "src", "agent", "guard-config.js"))});
    const s = translateToClaudeSettings(DEFAULT_GUARD_PROFILE);
    process.stdout.write(JSON.stringify({
      hasCustomBash: s.allow.includes("Bash(my-custom-tool:*)"),
      hasWebSearch: s.allow.includes("WebSearch"),
      totalAllow: s.allow.length,
    }));
  `;

  const result = spawnSync("node", ["-e", testScript], { cwd: tmpDir, encoding: "utf-8", timeout: 10000 });
  if (result.error) throw result.error;
  const r = JSON.parse(result.stdout.trim());
  assert(r.hasCustomBash === true, "custom baseline entry should appear in allow list");
  assert(r.hasWebSearch === true, "WebSearch should appear in allow list");
  assert(r.totalAllow === 3, "allow list should contain exactly 3 baseline entries");

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ testAllowToolsFlowsToTranslate passed");
}

/**
 * guard-profile.json allowTools 中非字符串条目应被过滤。
 */
function testAllowToolsFiltersNonStringEntries(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  fs.mkdirSync(path.join(tmpDir, "config"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "config", "guard-profile.json"), JSON.stringify({
    database: {}, filesystem: {}, network: {}, git: {},
    allowTools: ["Bash(ls:*)", 42, null, "WebSearch", true],
  }));
  fs.writeFileSync(path.join(tmpDir, "config", "logging.json"), JSON.stringify({ level: "warn", directory: "logs", filename_prefix: "snail-shell", max_file_size_mb: 10 }));

  const testScript = `
    const { translateToClaudeSettings, DEFAULT_GUARD_PROFILE } = require(${JSON.stringify(path.join(process.cwd(), "dist", "src", "agent", "guard-config.js"))});
    const s = translateToClaudeSettings(DEFAULT_GUARD_PROFILE);
    process.stdout.write(JSON.stringify({
      entries: s.allow,
      count: s.allow.length,
    }));
  `;

  const result = spawnSync("node", ["-e", testScript], { cwd: tmpDir, encoding: "utf-8", timeout: 10000 });
  if (result.error) throw result.error;
  const r = JSON.parse(result.stdout.trim());
  assert(r.count === 2, `non-string entries should be filtered, got ${r.count} entries: ${JSON.stringify(r.entries)}`);
  assert(r.entries.includes("Bash(ls:*)"), "valid string entry should be kept");
  assert(r.entries.includes("WebSearch"), "valid string entry should be kept");

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ testAllowToolsFiltersNonStringEntries passed");
}

// OpenCode: 无 per-project 配置入口
// 后续支持 per-project 配置后可补充测试。

// ──── 配置来源优先级 ────

/**
 * resolveGuardProfile 在 project.guard_profile 有值时覆盖系统默认。
 * 优先级：project > config/guard-profile.json
 */
function testProjectOverrideHasPriority(): void {
  const projectOverride: Record<string, unknown> = {
    database: { mode: "allow" },
    filesystem: { mode: "deny" },
  };
  const resolved = resolveGuardProfile(projectOverride);
  assert(resolved.database.mode === "allow", "project override: database should be allow");
  assert(resolved.filesystem.mode === "deny", "project override: filesystem should be deny");
  // 未覆盖的领域使用系统默认
  assert(resolved.network.mode === DEFAULT_GUARD_PROFILE.network.mode, "unset domain should use system default");
  assert(resolved.git.mode === DEFAULT_GUARD_PROFILE.git.mode, "unset domain should use system default");
  console.log("✓ testProjectOverrideHasPriority passed");
}

/**
 * DEFAULT_GUARD_PROFILE 从 config/guard-profile.json 加载，四领域必须完整。
 */
function testConfigProfileHasAllDomains(): void {
  assert(typeof DEFAULT_GUARD_PROFILE.database === "object", "database domain must exist");
  assert(typeof DEFAULT_GUARD_PROFILE.filesystem === "object", "filesystem domain must exist");
  assert(typeof DEFAULT_GUARD_PROFILE.network === "object", "network domain must exist");
  assert(typeof DEFAULT_GUARD_PROFILE.git === "object", "git domain must exist");
  console.log("✓ testConfigProfileHasAllDomains passed");
}

/**
 * 非法 config/guard-profile.json → 字段级回退到 DOMAIN_DEFAULTS。
 * 通过子进程验证：写入 mode="invalid" 的配置后，对应 domain 回退。
 * （文件缺失场景直接报错，不在此测试）
 */
function testInvalidConfigFieldsFallback(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-test-"));
  fs.mkdirSync(path.join(tmpDir, "config"), { recursive: true });
  // 提供四领域骨架但字段值非法
  fs.writeFileSync(path.join(tmpDir, "config", "guard-profile.json"), JSON.stringify({
    database: { mode: "invalid_mode" },
    filesystem: { denyPatterns: "not_an_array" },
    network: "not_an_object",
    git: {},
  }));
  // logger 需要 logging.json 存在
  fs.writeFileSync(path.join(tmpDir, "config", "logging.json"), JSON.stringify({ level: "warn", directory: "logs", filename_prefix: "snail-shell", max_file_size_mb: 10 }));

  const testScript = `
    const { DEFAULT_GUARD_PROFILE } = require(${JSON.stringify(path.join(process.cwd(), "dist", "src", "agent", "guard-config.js"))});
    process.stdout.write(JSON.stringify({
      databaseMode: DEFAULT_GUARD_PROFILE.database.mode,
      databaseDeny: Array.isArray(DEFAULT_GUARD_PROFILE.database.denyPatterns) && DEFAULT_GUARD_PROFILE.database.denyPatterns.length > 0,
      filesystemDeny: Array.isArray(DEFAULT_GUARD_PROFILE.filesystem.denyPatterns) && DEFAULT_GUARD_PROFILE.filesystem.denyPatterns.length > 0,
      networkMode: DEFAULT_GUARD_PROFILE.network.mode,
      gitMode: DEFAULT_GUARD_PROFILE.git.mode,
    }));
  `;

  const result = spawnSync("node", ["-e", testScript], { cwd: tmpDir, encoding: "utf-8", timeout: 10000 });
  if (result.error) throw result.error;
  const r = JSON.parse(result.stdout.trim());
  assert(r.databaseMode === "deny", "invalid mode should fallback to deny");
  assert(r.databaseDeny === true, "database denyPatterns should fallback");
  assert(r.filesystemDeny === true, "filesystem denyPatterns should fallback");
  assert(r.networkMode === "allow", "non-object domain should fallback");
  assert(r.gitMode === "allow", "empty object should use defaults");

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ testInvalidConfigFieldsFallback passed");
}

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
testWriteCodexGuardConfigMerge();
testWriteCodexGuardConfigMergeDoesNotTouchSectionKey();
testWriteCodexGuardConfigMergeInsertBeforeSection();
testProjectOverrideHasPriority();
testConfigProfileHasAllDomains();
testInvalidConfigFieldsFallback();
testAllowToolsMissingDefaultsToEmpty();
testAllowToolsFlowsToTranslate();
testAllowToolsFiltersNonStringEntries();
console.log("\nguard-config tests passed");
