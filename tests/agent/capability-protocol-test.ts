import { collectActiveSkills } from "../../src/agent/capability";
import type { AgentCapability, SkillCapability } from "../../src/agent/capability";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// ──── SkillCapability 类型校验 ────

/**
 * ACP 协议的 SkillCapability 不应包含 Snail Shell 内部概念
 * (如 mode、reason、title)。确认类型定义不暴露这些字段。
 */
function testSkillCapabilityDoesNotLeakInternalConcepts(): void {
  // 构造合法 SkillCapability 对象——只含 ACP 协议字段：
  const skill: SkillCapability = {
    name: "test",
    description: "test desc",
    filePath: "path/to/SKILL.md",
    directory: "path/to",
    content: "# Test\n\nContent.",
  };

  // 访问不存在的字段会触发 tsc 编译错误——这本身就是类型安全的验证。
  // 此处通过 any 断言在运行时确认字段为 undefined：
  const anySkill = skill as unknown as Record<string, unknown>;
  assert(typeof anySkill["mode"] === "undefined", "mode should NOT exist on SkillCapability");
  assert(typeof anySkill["reason"] === "undefined", "reason should NOT exist on SkillCapability");
  assert(typeof anySkill["title"] === "undefined", "title should NOT exist on SkillCapability");
  console.log("✓ testSkillCapabilityDoesNotLeakInternalConcepts passed");
}

/**
 * AgentCapability 只包含 systemPrompt 和 skills，不包含 prompts 等 Snail Shell 内部字段。
 */
function testAgentCapabilityOnlyHasSystemPromptAndSkills(): void {
  const cap: AgentCapability = { systemPrompt: "test", skills: [] };
  const anyCap = cap as unknown as Record<string, unknown>;
  assert(typeof anyCap["prompts"] === "undefined", "prompts should NOT exist on AgentCapability");
  console.log("✓ testAgentCapabilityOnlyHasSystemPromptAndSkills passed");
}

// ──── collectActiveSkills 行为测试 ────

/**
 * 给定包含 skill_references 的 prompt，应收集到对应的 SkillCapability。
 * SkillCapability 只包含 ACP 协议字段 (name/description/filePath/directory/content)。
 */
function testCollectActiveSkillsFromPromptReferences(): void {
  const skills = collectActiveSkills(
    ["B-01"],
    [
      {
        id: "B-01",
        title: "身份与责任契约",
        content: "## 身份与责任契约\n\n<identity>test</identity>",
        filePath: ".meta/prompts/prompts/B-01.md",
        skill_references: [
          { id: "message-out", mode: "required", reason: "for structured output" },
        ],
      },
    ],
  );

  assert(skills.length === 1, "should collect one skill from B-01");
  const s = skills[0];
  assert(s.name === "message-out", "skill name should match");
  assert(s.description.length > 0, "skill should have a description");
  assert(s.content.length > 0, "skill should have SKILL.md content");
  assert(s.filePath.endsWith("SKILL.md"), "skill should have filePath");
  assert(s.directory.length > 0, "skill should have directory");
  // 确认无 Snail Shell 内部概念泄露
  const anySkill = s as unknown as Record<string, unknown>;
  assert(typeof anySkill["mode"] === "undefined", "mode should NOT leak into SkillCapability");
  assert(typeof anySkill["reason"] === "undefined", "reason should NOT leak into SkillCapability");
  assert(typeof anySkill["title"] === "undefined", "title should NOT leak into SkillCapability");
  console.log("✓ testCollectActiveSkillsFromPromptReferences passed");
}

/**
 * 多个 prompt 引用同一个 skill 时去重。
 */
function testCollectActiveSkillsDeduplicates(): void {
  const sharedRef = { id: "message-out", mode: "required" as const, reason: "test" };
  const skills = collectActiveSkills(
    ["B-01", "S-03"],
    [
      {
        id: "B-01", title: "B-01", content: "## B-01\n\ntest",
        filePath: ".meta/prompts/prompts/B-01.md",
        skill_references: [sharedRef],
      },
      {
        id: "S-03", title: "S-03", content: "## S-03\n\ntest",
        filePath: ".meta/prompts/prompts/S-03.md",
        skill_references: [sharedRef],
      },
    ],
  );

  assert(skills.length === 1, "same skill from multiple prompts should be deduplicated to one entry");
  console.log("✓ testCollectActiveSkillsDeduplicates passed");
}

/**
 * prompt 无 skill_references 时返回空数组。
 */
function testCollectActiveSkillsEmptyWhenNoReferences(): void {
  const skills = collectActiveSkills(
    ["S-01"],
    [
      {
        id: "S-01", title: "项目上下文", content: "## 项目上下文\n\ntest",
        filePath: ".meta/prompts/prompts/S-01.md",
        // 无 skill_references
      },
    ],
  );

  assert(skills.length === 0, "prompt without skill_references should produce empty skills[]");
  console.log("✓ testCollectActiveSkillsEmptyWhenNoReferences passed");
}

/**
 * 未知 prompt ID 不报错，返回空数组。
 */
function testCollectActiveSkillsIgnoresUnknownPromptIds(): void {
  const skills = collectActiveSkills(["X-99"], []);
  assert(skills.length === 0, "unknown prompt IDs should be silently ignored");
  console.log("✓ testCollectActiveSkillsIgnoresUnknownPromptIds passed");
}

// ──── 运行所有测试 ────

testSkillCapabilityDoesNotLeakInternalConcepts();
testAgentCapabilityOnlyHasSystemPromptAndSkills();
testCollectActiveSkillsFromPromptReferences();
testCollectActiveSkillsDeduplicates();
testCollectActiveSkillsEmptyWhenNoReferences();
testCollectActiveSkillsIgnoresUnknownPromptIds();
console.log("\ncapability-protocol tests passed");
