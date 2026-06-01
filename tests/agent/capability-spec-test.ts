import fs from "fs";
import path from "path";
import os from "os";
import { collectActiveSkills } from "../../src/agent/capability";
import type { AgentCapability, SkillCapability } from "../../src/agent/capability";
import { DEFAULT_GUARD_PROFILE } from "../../src/agent/guard-config";
import { listSkillsWithWorkspace } from "../../src/skill-center";
import { ensureSkillSymlinks, cleanupSkillSymlinks } from "../../src/agent/skill-symlinks";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

/** 构造含全部 ACS 字段的合法 AgentCapability */
function makeCapability(overrides: Partial<AgentCapability> = {}): AgentCapability {
  return {
    systemPrompt: overrides.systemPrompt ?? "test",
    systemReminder: overrides.systemReminder ?? "",
    skills: overrides.skills ?? [],
    mcpServers: overrides.mcpServers ?? [],
    hooks: overrides.hooks ?? [],
    permissions: overrides.permissions ?? { defaultMode: "ask", rules: {} },
    tools: overrides.tools ?? [],
    subAgents: overrides.subAgents ?? [],
    guardProfile: overrides.guardProfile ?? DEFAULT_GUARD_PROFILE,
  };
}

// ──── SkillCapability 类型校验 ────

/**
 * ACS 的 SkillCapability 不应包含 Snail Shell 内部概念
 * (如 mode、reason、title)。确认类型定义不暴露这些字段。
 */
function testSkillCapabilityDoesNotLeakInternalConcepts(): void {
  const skill: SkillCapability = {
    name: "test",
    description: "test desc",
    filePath: "path/to/SKILL.md",
    directory: "path/to",
    content: "# Test\n\nContent.",
  };

  const anySkill = skill as unknown as Record<string, unknown>;
  assert(typeof anySkill["mode"] === "undefined", "mode should NOT exist on SkillCapability");
  assert(typeof anySkill["reason"] === "undefined", "reason should NOT exist on SkillCapability");
  assert(typeof anySkill["title"] === "undefined", "title should NOT exist on SkillCapability");
  console.log("✓ testSkillCapabilityDoesNotLeakInternalConcepts passed");
}

/**
 * AgentCapability 包含全部 7 个维度字段。
 */
function testAgentCapabilityHasAllProtocolFields(): void {
  const cap = makeCapability();
  assert(typeof cap.systemPrompt === "string", "systemPrompt must exist");
  assert(Array.isArray(cap.skills), "skills must exist");
  assert(Array.isArray(cap.mcpServers), "mcpServers must exist");
  assert(Array.isArray(cap.hooks), "hooks must exist");
  assert(typeof cap.permissions === "object", "permissions must exist");
  assert(Array.isArray(cap.tools), "tools must exist");
  assert(Array.isArray(cap.subAgents), "subAgents must exist");
  assert(typeof cap.guardProfile === "object" && cap.guardProfile !== null, "guardProfile must exist");
  assert(Array.isArray(cap.guardProfile.allow), "guardProfile.allow must be an array");
  assert(Array.isArray(cap.guardProfile.deny), "guardProfile.deny must be an array");
  console.log("✓ testAgentCapabilityHasAllProtocolFields passed");
}

// ──── collectActiveSkills 行为测试 ────

/**
 * collectActiveSkills() 无参数调用，返回所有已注册的 skill。
 * SkillCapability 只含 ACS 字段 (name/description/filePath/directory/content)。
 */
function testCollectActiveSkillsReturnsAllRegistered(): void {
  const skills = collectActiveSkills();

  assert(skills.length > 0, "should return at least one skill");
  const s = skills[0];
  assert(s.name.length > 0, "skill should have a name");
  assert(s.description.length > 0, "skill should have a description");
  assert(s.content.length > 0, "skill should have SKILL.md content");
  assert(s.filePath.endsWith("SKILL.md"), "skill should have filePath ending with SKILL.md");
  assert(s.directory.length > 0, "skill should have directory");
  // 确认无 Snail Shell 内部概念泄露
  const anySkill = s as unknown as Record<string, unknown>;
  assert(typeof anySkill["mode"] === "undefined", "mode should NOT leak into SkillCapability");
  assert(typeof anySkill["reason"] === "undefined", "reason should NOT leak into SkillCapability");
  assert(typeof anySkill["title"] === "undefined", "title should NOT leak into SkillCapability");
  console.log("✓ testCollectActiveSkillsReturnsAllRegistered passed");
}

// ──── 工作区级 skill 合并测试 ────

/**
 * listSkillsWithWorkspace() 在工作区级 skill 目录不存在时，返回与 listSkills() 相同的结果。
 */
function testListSkillsWithWorkspaceNoWorkspaceDir(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snail-test-"));
  try {
    const globalSkills = collectActiveSkills();
    const merged = listSkillsWithWorkspace(tmpDir);
    assert(merged.length === globalSkills.length, "without workspace skills dir, should return same count as global");
    assert(merged.length > 0, "should have at least one global skill");
    console.log("✓ testListSkillsWithWorkspaceNoWorkspaceDir passed");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * listSkillsWithWorkspace() 合并全局和工作区级 skill，工作区级同名覆盖全局。
 */
function testListSkillsWithWorkspaceOverride(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snail-test-"));
  try {
    // 创建一个工作区级 skill，与全局 skill 同名但 description 不同
    const workspaceSkillDir = path.join(tmpDir, ".snail", "skills", "test-override");
    fs.mkdirSync(workspaceSkillDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceSkillDir, "SKILL.md"), "---\nname: test-override\ndescription: workspace override\n---\n# Workspace Override\n");

    const merged = listSkillsWithWorkspace(tmpDir);
    const override = merged.find((s) => s.name === "test-override");
    assert(!!override, "workspace-level skill should be in merged list");
    assert(override!.description === "workspace override", "workspace-level skill should override with workspace description");
    console.log("✓ testListSkillsWithWorkspaceOverride passed");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * collectActiveSkills(workspaceRoot) 传递 workspaceRoot 时，返回合并后的 skill 列表。
 */
function testCollectActiveSkillsWithWorkspaceRoot(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snail-test-"));
  try {
    const globalSkills = collectActiveSkills();
    const mergedWithWorkspace = collectActiveSkills(tmpDir);
    assert(mergedWithWorkspace.length === globalSkills.length, "without workspace skills, count should match global");
    console.log("✓ testCollectActiveSkillsWithWorkspaceRoot passed");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ──── 符号链接测试 ────

/**
 * ensureSkillSymlinks() 创建 .claude/skills/ 和 .agents/skills/ 符号链接目录。
 */
function testEnsureSkillSymlinks(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snail-test-"));
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "snail-target-"));
  try {
    const skills: SkillCapability[] = [
      { name: "test-skill", description: "test", filePath: path.join(targetDir, "SKILL.md"), directory: targetDir, content: "# Test" },
    ];
    ensureSkillSymlinks(tmpDir, skills);

    const claudeLink = path.join(tmpDir, ".claude", "skills", "test-skill");
    const agentsLink = path.join(tmpDir, ".agents", "skills", "test-skill");
    assert(fs.existsSync(claudeLink), ".claude/skills/test-skill should exist");
    assert(fs.existsSync(agentsLink), ".agents/skills/test-skill should exist");
    assert(fs.lstatSync(claudeLink).isSymbolicLink(), ".claude/skills/test-skill should be a symlink");
    assert(fs.readlinkSync(claudeLink) === targetDir, ".claude/skills/test-skill should point to targetDir");
    console.log("✓ testEnsureSkillSymlinks passed");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
}

/**
 * cleanupSkillSymlinks() 清理创建的符号链接。
 */
function testCleanupSkillSymlinks(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snail-test-"));
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "snail-target-"));
  try {
    const skills: SkillCapability[] = [
      { name: "test-skill", description: "test", filePath: path.join(targetDir, "SKILL.md"), directory: targetDir, content: "# Test" },
    ];
    ensureSkillSymlinks(tmpDir, skills);
    assert(fs.existsSync(path.join(tmpDir, ".claude", "skills")), ".claude/skills should exist after ensure");

    cleanupSkillSymlinks(tmpDir);
    assert(!fs.existsSync(path.join(tmpDir, ".claude", "skills")), ".claude/skills should be removed after cleanup");
    assert(!fs.existsSync(path.join(tmpDir, ".agents", "skills")), ".agents/skills should be removed after cleanup");
    console.log("✓ testCleanupSkillSymlinks passed");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
}

/**
 * ensureSkillSymlinks() 不覆盖用户手动创建的真实目录。
 */
function testEnsureSkillSymlinksDoesNotOverwriteRealDirs(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snail-test-"));
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "snail-target-"));
  try {
    // 先创建一个真实目录
    const realDir = path.join(tmpDir, ".claude", "skills", "existing-skill");
    fs.mkdirSync(realDir, { recursive: true });
    fs.writeFileSync(path.join(realDir, "SKILL.md"), "real content");

    const skills: SkillCapability[] = [
      { name: "existing-skill", description: "test", filePath: path.join(targetDir, "SKILL.md"), directory: targetDir, content: "# Test" },
    ];
    ensureSkillSymlinks(tmpDir, skills);

    // 真实目录不应被覆盖为符号链接
    assert(!fs.lstatSync(realDir).isSymbolicLink(), "real directory should NOT be overwritten with symlink");
    assert(fs.readFileSync(path.join(realDir, "SKILL.md"), "utf-8") === "real content", "real directory content should be preserved");
    console.log("✓ testEnsureSkillSymlinksDoesNotOverwriteRealDirs passed");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
}

// ──── 运行所有测试 ────

testSkillCapabilityDoesNotLeakInternalConcepts();
testAgentCapabilityHasAllProtocolFields();
testCollectActiveSkillsReturnsAllRegistered();
testListSkillsWithWorkspaceNoWorkspaceDir();
testListSkillsWithWorkspaceOverride();
testCollectActiveSkillsWithWorkspaceRoot();
testEnsureSkillSymlinks();
testCleanupSkillSymlinks();
testEnsureSkillSymlinksDoesNotOverwriteRealDirs();
console.log("\ncapability-spec tests passed");
