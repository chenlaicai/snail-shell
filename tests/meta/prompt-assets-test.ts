import assert from "assert";
import fs from "fs";
import path from "path";
import { getPrompt, listPrompts, renderPromptContent, assembleSystemPrompt, matchesWhen, loadProjectPrompts, mergePrompts } from "../../src/prompt-center";
import { getSkill, listSkills } from "../../src/skill-center";

// Full prompt set: platform + Snail Shell project overlay
const projectRoot = process.cwd();
const platformPrompts = listPrompts();
const projectOverlay = loadProjectPrompts(projectRoot);
const allPrompts = mergePrompts(platformPrompts, projectOverlay);
const assemblyPool = allPrompts.filter((p) => p.id !== "S-05" && p.id !== "S-06");

function testPromptLayering(): void {
  // Platform prompts (via listPrompts) are the runtime-invariant base
  assert(platformPrompts.some((p) => p.id === "B-01"), "B-01 in platform");
  assert(platformPrompts.some((p) => p.id === "S-02"), "S-02 in platform");
  assert(platformPrompts.some((p) => p.id === "S-07"), "S-07 in platform");

  // SOP handbooks live in platform pool (loaded by listPrompts for all projects)
  assert(platformPrompts.some((p) => p.id === "S-03"), "S-03 in platform");
  assert(platformPrompts.some((p) => p.id === "S-04"), "S-04 in platform");
  assert(platformPrompts.some((p) => p.id === "S-08"), "S-08 in platform");

  // Merged set is complete (platform + project overlay)
  assert(allPrompts.some((p) => p.id === "B-01"), "B-01 in merged");
  assert(allPrompts.some((p) => p.id === "S-03"), "S-03 in merged");
  assert(allPrompts.length === 11, "11 total prompts in merged set");

  // Metadata on SOP prompts (in platform pool)
  const s03 = platformPrompts.find((p) => p.id === "S-03")!;
  assert(s03.layer === "sop", "S-03 should be sop layer");
  assert(s03.when?.roles?.includes("研发者"), "S-03 when roles includes 研发者");

  const s08 = platformPrompts.find((p) => p.id === "S-08")!;
  assert(s08.layer === "sop", "S-08 should be sop layer");
  assert(s08.when?.owner_types?.includes("knowledge_governance"), "S-08 when includes knowledge_governance");

  // Platform prompt metadata
  const b03 = getPrompt("B-03");
  assert(b03.layer === "platform", "B-03 should be platform");
  assert(b03.priority === 30, "B-03 priority should be 30");
  assert(b03.when?.runtimes?.includes("claude-code-cli"), "B-03 when includes claude-code-cli");

  assert(platformPrompts.every((p) => /^[BS]-\d{2}$/.test(p.id)), "prompt ids use B-/S- prefix");
  assert(allPrompts.every((p) => typeof p.layer === "string" && typeof p.priority === "number"), "all prompts have layer/priority");
}

function testSkillDiscovery(): void {
  const skills = listSkills();
  assert(skills.some((s) => s.name === "message-out"), "message-out skill discoverable");
  assert(getSkill("message-out").content.includes("# Message Out Protocol"), "message-out content readable");
}

function testMatchesWhen(): void {
  assert(matchesWhen(undefined, {}), "undefined when matches");
  assert(matchesWhen({}, {}), "empty when matches");
  assert(matchesWhen({ runtimes: ["claude-code-cli"] }, { runtime: "claude-code-cli" }), "matching runtime");
  assert(!matchesWhen({ runtimes: ["claude-code-cli"] }, { runtime: "opencode-cli" }), "non-matching runtime");
  assert(matchesWhen({ roles: ["研发者"] }, { roleName: "研发者" }), "matching role");
  assert(!matchesWhen({ roles: ["研发者"] }, { roleName: "检视者" }), "non-matching role");
  assert(matchesWhen({ runtimes: ["claude-code-cli"], roles: ["研发者"] }, { runtime: "claude-code-cli", roleName: "研发者" }), "multi-match");
  assert(!matchesWhen({ runtimes: ["claude-code-cli"], roles: ["研发者"] }, { runtime: "opencode-cli", roleName: "研发者" }), "partial fail");
}

function testAssemblyEngine(): void {
  const ctx = { runtime: "claude-code-cli" as const, stageType: "development" as const, roleName: "研发者" as const, conversationKind: "discussion" as const, ownerType: "project_stage" as const };

  const dev = assembleSystemPrompt({ prompts: assemblyPool, matchContext: ctx, variables: { project_name: "test" } });
  assert(dev.systemPrompt.length > 0, "systemPrompt non-empty");
  assert(dev.systemReminder.includes("必须能合理归属于当前"), "S-01 in systemReminder");
  assert(dev.systemPrompt.includes("Snail Shell AI"), "B-01 in systemPrompt");
  assert(dev.systemPrompt.includes("理解历史上下文"), "B-03 with CLI runtime");
  assert(dev.systemPrompt.includes("全链路影响分析"), "S-03 with 研发者 role");
  assert(!dev.systemPrompt.includes("Snail Shell PR 检视者"), "S-04 not for 研发者");
  assert(dev.activePromptIds.includes("S-03"), "S-03 active");
  assert(!dev.activePromptIds.includes("S-04"), "S-04 not active");

  const rev = assembleSystemPrompt({
    prompts: assemblyPool,
    matchContext: { runtime: "opencode-cli", stageType: "review", roleName: "检视者", conversationKind: "discussion", ownerType: "project_stage" },
    variables: { project_name: "test" },
  });
  assert(rev.systemPrompt.includes("Snail Shell PR 检视者"), "S-04 with 检视者");
  assert(!rev.systemPrompt.includes("理解历史上下文"), "B-03 not for non-CLI");
  assert(!rev.systemPrompt.includes("全链路影响分析"), "S-03 not for 检视者");

  assert(rev.activePromptIds.indexOf("S-04") < rev.activePromptIds.indexOf("B-01"), "SOP before Platform");
}

function testPromptRendering(): void {
  assert(renderPromptContent(getPrompt("B-01"), {}).includes("简体中文"), "B-01 Chinese rule");
  assert(renderPromptContent(getPrompt("B-02"), {}).includes("触发场景"), "B-02 triggers");
  assert(renderPromptContent(getPrompt("B-03"), {}).includes("非交互式调度环境中不可用"), "B-03 boundaries");
  assert(renderPromptContent(getPrompt("S-01"), {}).includes("必须能合理归属于当前"), "S-01 context");

  const s03 = platformPrompts.find((p) => p.id === "S-03")!;
  assert(renderPromptContent(s03, {}).includes("当前身份：Snail Shell 研发者"), "S-03 dev identity");
  assert(renderPromptContent(s03, {}).includes("全链路影响分析"), "S-03 full-chain analysis");

  const s04 = platformPrompts.find((p) => p.id === "S-04")!;
  assert(renderPromptContent(s04, {}).includes("当前身份：Snail Shell PR 检视者"), "S-04 reviewer identity");
  assert(renderPromptContent(s04, {}).includes("commit/PR 模板"), "S-04 template check");

  const tmpl = fs.readFileSync(path.join(process.cwd(), ".meta", "prompts", "_template-prompt.md"), "utf8");
  assert(tmpl.includes("layer:") && tmpl.includes("priority:"), "template has new fields");
}

function testSerializable(): void {
  const s = JSON.parse(JSON.stringify(allPrompts));
  const s01 = s.find((x: any) => x.id === "S-01");
  assert(s01 && typeof s01.layer === "string" && typeof s01.priority === "number", "serializable");
}

testPromptLayering();
testSkillDiscovery();
testMatchesWhen();
testAssemblyEngine();
testPromptRendering();
testSerializable();

console.log("prompt-assets tests passed");
