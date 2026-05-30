import { collectActiveSkills } from "../../src/agent/capability";
import type { AgentCapability, SkillCapability } from "../../src/agent/capability";
import { DEFAULT_GUARD_PROFILE } from "../../src/agent/guard-config";

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

// ──── 运行所有测试 ────

testSkillCapabilityDoesNotLeakInternalConcepts();
testAgentCapabilityHasAllProtocolFields();
testCollectActiveSkillsReturnsAllRegistered();
console.log("\ncapability-spec tests passed");
