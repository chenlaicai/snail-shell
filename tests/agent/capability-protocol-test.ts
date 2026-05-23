import { buildSystemPromptFromCapability, buildAgentCapability } from "../../src/agent/capability";
import type { AgentCapability, CapabilityBuildInput, SkillCapability } from "../../src/agent/capability";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// ──── buildSystemPromptFromCapability 行为测试 ────

function testNoCapabilityReturnsBaseUnchanged(): void {
  const base = "## System Prompt\n\nBase content.";
  const result = buildSystemPromptFromCapability(base, undefined);
  assert(result === base, "without capability should return base system prompt unchanged");
  console.log("✓ testNoCapabilityReturnsBaseUnchanged passed");
}

function testEmptySkillsReturnsBaseUnchanged(): void {
  const base = "## System Prompt\n\nBase content.";
  const capability: AgentCapability = { systemPrompt: base, prompts: [], skills: [] };
  const result = buildSystemPromptFromCapability(base, capability);
  assert(result === base, "empty skills should return base system prompt unchanged");
  console.log("✓ testEmptySkillsReturnsBaseUnchanged passed");
}

function makeSkill(overrides: Partial<SkillCapability> = {}): SkillCapability {
  return {
    name: overrides.name ?? "test-skill",
    description: overrides.description ?? "A test skill",
    filePath: overrides.filePath ?? ".meta/skills/test-skill/SKILL.md",
    directory: overrides.directory ?? ".meta/skills/test-skill",
    mode: overrides.mode ?? "required",
    reason: overrides.reason ?? "for testing",
    content: overrides.content ?? "# Test Skill\n\n## Protocol\n\nDo the thing.",
    title: overrides.title ?? "Test Skill",
  };
}

function testConditionalSkillsOnlyReturnBaseUnchanged(): void {
  const base = "## System Prompt\n\nBase content.";
  const skill = makeSkill({ mode: "conditional", name: "conditional-skill" });
  const capability: AgentCapability = { systemPrompt: base, prompts: [], skills: [skill] };
  const result = buildSystemPromptFromCapability(base, capability);
  assert(result === base, "only conditional skills should return base system prompt unchanged (conditional not force-injected)");
  console.log("✓ testConditionalSkillsOnlyReturnBaseUnchanged passed");
}

function testRequiredSkillInjectedWithTag(): void {
  const base = "## System Prompt\n\nBase content.";
  const skill = makeSkill({
    mode: "required",
    name: "message-out",
    title: "Message Out",
    content: "# Message Out\n\n## Protocol\n\nSend structured messages.",
  });
  const capability: AgentCapability = { systemPrompt: base, prompts: [], skills: [skill] };
  const result = buildSystemPromptFromCapability(base, capability);

  assert(result !== base, "required skill should modify system prompt");
  assert(result.includes("[CAPABILITY-SKILL:message-out]"), "required skill injection should include CAPABILITY-SKILL tag for traceability");
  assert(result.includes("## Protocol"), "required skill content should be injected (one-level heading stripped)");
  /** `### Message Out` 三级标题中包含 `# Message Out` 子串，因此必须用行锚点检查一级 heading 是否被剥离 */
  assert(!/^# Message Out/m.test(result), "original skill # heading must be stripped (### title in capability section should not be confused)");
  assert(result.includes("## 能力注入"), "Capability Protocol section header should be present");
  console.log("✓ testRequiredSkillInjectedWithTag passed");
}

function testMixedSkillsOnlyInjectRequired(): void {
  const base = "## System Prompt\n\nBase content.";
  const requiredSkill = makeSkill({ mode: "required", name: "skill-a", title: "Skill A", content: "# Skill A\n\nContent A." });
  const conditionalSkill = makeSkill({ mode: "conditional", name: "skill-b", title: "Skill B", content: "# Skill B\n\nContent B." });
  const capability: AgentCapability = { systemPrompt: base, prompts: [], skills: [requiredSkill, conditionalSkill] };
  const result = buildSystemPromptFromCapability(base, capability);

  assert(result.includes("[CAPABILITY-SKILL:skill-a]"), "should inject required skill-a");
  assert(result.includes("Content A."), "should include required skill content");
  assert(!result.includes("[CAPABILITY-SKILL:skill-b]"), "should NOT inject conditional skill-b");
  assert(!result.includes("Content B."), "should NOT include conditional skill content");
  console.log("✓ testMixedSkillsOnlyInjectRequired passed");
}

// ──── buildAgentCapability 行为测试 ────
//
// buildAgentCapability 内部调用 renderFrame()，而 renderFrame 通过
// {{prompt:B-01}} 引用会展开 registry 中的 REAL prompt 内容。
// 为了测试 collectActivePrompts 的过滤逻辑而不依赖 registry，
// frame.content 直接包含 prompt 内容（无 {{prompt:...}} 引用），
// 这样 systemPrompt 完全由 frame 内容决定，isPromptInSystemPrompt 的
// 标题匹配可以精确控制。

/**
 * B-* prompt 被分类为 "base"，S-* prompt 被分类为 "scenario"。
 *
 * frame 不包含 {{prompt:...}} 引用，而是直接嵌入 prompt 的标题行。
 * renderFrame 处理后 systemPrompt 包含 "## 身份与责任契约" 和 "## 项目上下文"，
 * isPromptInSystemPrompt 按标题匹配激活相应的 PromptCapability。
 */
function testBuildAgentCapabilityModeClassification(): void {
  const frameContent = "## Frame\n\n## 身份与责任契约\nIdentity contract.\n\n## 项目上下文\nProject context.";

  const input: CapabilityBuildInput = {
    frame: {
      id: "F-01",
      title: "Test Frame",
      type: "frame",
      content: frameContent,
      filePath: ".meta/prompts/frames/test.md",
    },
    frameContext: {},
    variables: {},
    prompts: [
      { id: "B-01", title: "身份与责任契约", content: "## 身份与责任契约\n\nIdentity contract.", filePath: ".meta/prompts/prompts/B-01.md" },
      { id: "S-01", title: "项目上下文", content: "## 项目上下文\n\nProject context.", filePath: ".meta/prompts/prompts/S-01.md" },
    ],
    referencedPromptIds: ["B-01", "S-01"],
  };

  const capability = buildAgentCapability(input);

  const bPrompt = capability.prompts.find((p) => p.id === "B-01");
  assert(bPrompt !== undefined, "B-01 should be in prompts[] (title appears in systemPrompt)");
  assert(bPrompt!.mode === "base", "B-01 should be classified as base mode (id starts with B-)");

  const sPrompt = capability.prompts.find((p) => p.id === "S-01");
  assert(sPrompt !== undefined, "S-01 should be in prompts[] (title appears in systemPrompt)");
  assert(sPrompt!.mode === "scenario", "S-01 should be classified as scenario mode (id starts with S-)");

  console.log("✓ testBuildAgentCapabilityModeClassification passed");
}

/**
 * 当 prompt 被引用链声明但未实际出现在 rendered systemPrompt 中时
 * （模拟 {{#when:...}} 条件过滤效果），不应出现在 prompts[] 中。
 */
function testBuildAgentCapabilityFilteredPromptExcluded(): void {
  const frameContent = "## Frame\n\n## 身份与责任契约\nIdentity contract.\n\nOther content.";

  const input: CapabilityBuildInput = {
    frame: {
      id: "F-01",
      title: "Test Frame",
      type: "frame",
      content: frameContent,
      filePath: ".meta/prompts/frames/test.md",
    },
    frameContext: {},
    variables: {},
    prompts: [
      { id: "B-01", title: "身份与责任契约", content: "## 身份与责任契约\n\nIdentity contract.", filePath: ".meta/prompts/prompts/B-01.md" },
      { id: "S-02", title: "历史能力", content: "## 历史能力\n\nHistory content.", filePath: ".meta/prompts/prompts/S-02.md" },
    ],
    /** S-02 在 referencedPromptIds 中但 systemPrompt 不含 "历史能力" → 应被过滤 */
    referencedPromptIds: ["B-01", "S-02"],
  };

  const capability = buildAgentCapability(input);

  const bPrompt = capability.prompts.find((p) => p.id === "B-01");
  assert(bPrompt !== undefined, "B-01 should be in prompts[] (its title '身份与责任契约' appears in systemPrompt)");

  const sPrompt = capability.prompts.find((p) => p.id === "S-02");
  assert(sPrompt === undefined, "S-02 should NOT be in prompts[] (title '历史能力' not in systemPrompt, simulating condition filter)");

  console.log("✓ testBuildAgentCapabilityFilteredPromptExcluded passed");
}

/**
 * 构建结果的 systemPrompt 应当包含 frame 内容（经过 renderFrame 处理后）。
 * 验证 frame 的 ## 标题和内容出现在 systemPrompt 中。
 */
function testBuildAgentCapabilitySystemPromptContainsExpandedPrompts(): void {
  const frameContent = "## Test Frame\n\nContent line.";
  const input: CapabilityBuildInput = {
    frame: {
      id: "F-01",
      title: "Test Frame",
      type: "frame",
      content: frameContent,
      filePath: ".meta/prompts/frames/test.md",
    },
    frameContext: {},
    variables: {},
    prompts: [],
    referencedPromptIds: [],
  };

  const capability = buildAgentCapability(input);

  assert(capability.systemPrompt.includes("## Test Frame"), "systemPrompt should contain frame heading");
  assert(capability.systemPrompt.includes("Content line"), "systemPrompt should contain frame body content");
  console.log("✓ testBuildAgentCapabilitySystemPromptContainsExpandedPrompts passed");
}

// ──── 运行所有测试 ────

testNoCapabilityReturnsBaseUnchanged();
testEmptySkillsReturnsBaseUnchanged();
testConditionalSkillsOnlyReturnBaseUnchanged();
testRequiredSkillInjectedWithTag();
testMixedSkillsOnlyInjectRequired();
testBuildAgentCapabilityModeClassification();
testBuildAgentCapabilityFilteredPromptExcluded();
testBuildAgentCapabilitySystemPromptContainsExpandedPrompts();
console.log("\ncapability-protocol tests passed");
