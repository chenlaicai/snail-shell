import assert from "assert";
import fs from "fs";
import path from "path";
import { getPrompt, listPrompts, renderPromptContent, assembleSystemPrompt, matchesWhen, loadWorkspacePrompts, mergePrompts } from "../../src/prompt-center";
import { getSkill, listSkills } from "../../src/skill-center";

// Full prompt set: platform + Snail Shell workspace overlay
const workspaceRoot = process.cwd();
const platformPrompts = listPrompts();
const workspaceOverlay = loadWorkspacePrompts(workspaceRoot);
const allPrompts = mergePrompts(platformPrompts, workspaceOverlay);
const assemblyPool = allPrompts.filter((p) => p.id !== "S-05" && p.id !== "S-06");

function testPromptLayering(): void {
  // Platform prompts (via listPrompts) are the runtime-invariant base
  assert(platformPrompts.some((p) => p.id === "B-01"), "B-01 in platform");
  assert(platformPrompts.some((p) => p.id === "S-02"), "S-02 in platform");
  // SOP handbooks live in platform pool (loaded by listPrompts for all workspaces)
  assert(platformPrompts.some((p) => p.id === "S-03"), "S-03 in platform");
  assert(platformPrompts.some((p) => p.id === "S-04"), "S-04 in platform");
  assert(platformPrompts.some((p) => p.id === "S-08"), "S-08 in platform");

  // Merged set is complete (platform + workspace overlay)
  assert(allPrompts.some((p) => p.id === "B-01"), "B-01 in merged");
  assert(allPrompts.some((p) => p.id === "S-03"), "S-03 in merged");
  assert(allPrompts.length >= 10, "at least 10 prompts in merged set");

  // Metadata on SOP prompts (in platform pool)
  const s03 = platformPrompts.find((p) => p.id === "S-03")!;
  assert(s03.layer === "sop", "S-03 should be sop layer");
  assert(s03.when?.roles?.includes("研发者"), "S-03 when roles includes 研发者");

  const s08 = platformPrompts.find((p) => p.id === "S-08")!;
  assert(s08.layer === "sop", "S-08 should be sop layer");
  assert(s08.when?.owner_types?.includes("evolution"), "S-08 when includes evolution");

  // Platform prompt metadata
  const b03 = getPrompt("B-03");
  assert(b03.layer === "platform", "B-03 should be platform");
  assert(b03.priority === 30, "B-03 priority should be 30");
  assert(b03.when?.runtimes?.includes("claude-code-cli"), "B-03 when includes claude-code-cli");

  // S-02 merged capability reference: has knowledge-library + prompt-constraints skill refs
  const s02 = getPrompt("S-02");
  assert(s02.layer === "platform", "S-02 should be platform layer");
  assert(s02.title === "能力引用", "S-02 should be renamed to 能力引用 after merge");
  assert(s02.content.includes("知识库"), "S-02 should include knowledge library section");
  assert(s02.content.includes("参考约束"), "S-02 should include reference constraints section");
  assert(s02.content.includes("知识库条目不能覆盖当前 stage"), "S-02 should include knowledge library behavioral rules");
  assert(s02.content.includes("knowledge_library_summary"), "S-02 should include knowledge library summary template");

  assert(platformPrompts.every((p) => /^[BS]-\d{2}$/.test(p.id)), "prompt ids use B-/S- prefix");
  assert(allPrompts.every((p) => typeof p.layer === "string" && typeof p.priority === "number"), "all prompts have layer/priority");
}

function testSkillDiscovery(): void {
  const skills = listSkills();
  assert(skills.some((s) => s.name === "message-out"), "message-out skill discoverable");
  assert(skills.some((s) => s.name === "prompt-constraints"), "prompt-constraints skill discoverable");
  assert(getSkill("message-out").content.includes("# Message Out Protocol"), "message-out content readable");

  const pc = getSkill("prompt-constraints");
  assert(pc.content.includes("全链路影响分析"), "prompt-constraints has design analysis rules");
  assert(pc.content.includes("检视"), "prompt-constraints has reviewer constraints");
  assert(pc.content.includes("演进治理"), "prompt-constraints has evolution governance constraints");
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
  const ctx = { runtime: "claude-code-cli" as const, stageType: "development" as const, roleName: "研发者" as const, conversationKind: "discussion" as const, ownerType: "workspace_stage" as const };

  const dev = assembleSystemPrompt({ prompts: assemblyPool, matchContext: ctx, variables: { workspace_name: "test" } });
  assert(dev.systemPrompt.length > 0, "systemPrompt non-empty");
  assert(dev.systemReminder.includes("必须能合理归属于当前"), "S-01 in systemReminder");
  assert(dev.systemPrompt.includes("简体中文"), "B-01 language rule in systemPrompt");
  assert(dev.systemPrompt.includes("非交互式调度环境中不可用"), "B-03 interactive tool prohibition in systemPrompt");
  assert(dev.systemReminder.includes("全链路影响分析"), "S-03 in systemReminder (dynamic)");
  assert(dev.systemReminder.includes("GATE-1"), "S-03 includes developer workflow GATE in systemReminder");
  assert(!dev.systemReminder.includes("Snail Shell PR 检视者"), "S-04 not for 研发者");
  assert(dev.activePromptIds.includes("S-03"), "S-03 active");
  assert(!dev.activePromptIds.includes("S-04"), "S-04 not active");
  assert(!dev.activePromptIds.includes("S-07"), "S-07 not active (merged into S-02)");
  assert(dev.activePromptIds.length <= 6, `dev activePromptIds should be <= 6, got ${dev.activePromptIds.length}: ${dev.activePromptIds.join(", ")}`);

  const rev = assembleSystemPrompt({
    prompts: assemblyPool,
    matchContext: { runtime: "opencode-cli", stageType: "review", roleName: "检视者", conversationKind: "discussion", ownerType: "workspace_stage" },
    variables: { workspace_name: "test" },
  });
  assert(rev.systemReminder.includes("Snail Shell PR 检视者"), "S-04 in systemReminder (dynamic)");
  assert(!rev.systemPrompt.includes("非交互式调度环境中不可用"), "B-03 not for non-CLI");
  assert(!rev.systemReminder.includes("全链路影响分析"), "S-03 not for 检视者");

  assert(rev.activePromptIds.indexOf("S-04") < rev.activePromptIds.indexOf("B-01"), "SOP before Platform");
  assert(rev.activePromptIds.length <= 6, `reviewer activePromptIds should be <= 6, got ${rev.activePromptIds.length}: ${rev.activePromptIds.join(", ")}`);
}

function testPromptRendering(): void {
  assert(renderPromptContent(getPrompt("B-01"), {}).includes("简体中文"), "B-01 Chinese rule");
  assert(renderPromptContent(getPrompt("B-02"), {}).includes("触发场景"), "B-02 triggers");
  assert(renderPromptContent(getPrompt("B-03"), {}).includes("非交互式调度环境中不可用"), "B-03 boundaries");
  assert(renderPromptContent(getPrompt("S-01"), {}).includes("必须能合理归属于当前"), "S-01 context");

  // S-03 compressed developer handbook
  const s03 = platformPrompts.find((p) => p.id === "S-03")!;
  assert(renderPromptContent(s03, {}).includes("当前身份：Snail Shell 研发者"), "S-03 dev identity");
  assert(renderPromptContent(s03, {}).includes("全链路影响分析"), "S-03 full-chain analysis");
  assert(renderPromptContent(s03, {}).includes("prompt-constraints"), "S-03 references prompt-constraints");
  assert(renderPromptContent(s03, {}).includes("检视未清零前不宣称完成"), "S-03 review completion criteria");

  // S-04 compressed reviewer handbook
  const s04 = platformPrompts.find((p) => p.id === "S-04")!;
  assert(renderPromptContent(s04, {}).includes("Snail Shell PR 检视者"), "S-04 reviewer identity");
  assert(renderPromptContent(s04, {}).includes("prompt-constraints"), "S-04 references prompt-constraints");
  assert(renderPromptContent(s04, {}).includes("复检是检视闭环的一部分"), "S-04 re-review integral");

  // S-08 compressed knowledge executor handbook
  const s08 = platformPrompts.find((p) => p.id === "S-08")!;
  assert(renderPromptContent(s08, {}).includes("prompt-constraints"), "S-08 references prompt-constraints");
  assert(renderPromptContent(s08, {}).includes("入口校验是第一步"), "S-08 keeps core constitution");

  // S-02 merged capability reference
  const s02 = platformPrompts.find((p) => p.id === "S-02")!;
  assert(renderPromptContent(s02, {}).includes("prompt-constraints"), "S-02 references prompt-constraints");
  assert(renderPromptContent(s02, {}).includes("只有当前摘要"), "S-02 history rules preserved");

  const tmpl = fs.readFileSync(path.join(process.cwd(), ".meta", "prompts", "_template-prompt.md"), "utf8");
  assert(tmpl.includes("layer:") && tmpl.includes("priority:"), "template has new fields");

  // README architecture constraint
  const readme = fs.readFileSync(path.join(process.cwd(), ".meta", "README.md"), "utf8");
  assert(readme.includes("条数约束") || readme.includes("prompt-constraints"), "README has architecture constraint docs");
}

function testSerializable(): void {
  const s = JSON.parse(JSON.stringify(allPrompts));
  const s01 = s.find((x: any) => x.id === "S-01");
  assert(s01 && typeof s01.layer === "string" && typeof s01.priority === "number", "serializable");
}

function testReferenceExclusion(): void {
  // Reference directory should NOT be parsed as prompts
  const refDir = path.join(process.cwd(), ".meta", "prompts", "reference");
  assert(fs.existsSync(refDir), "reference directory exists");
  const refFiles = fs.readdirSync(refDir).filter((f) => f.endsWith(".md"));
  assert(refFiles.length > 0, "reference files exist");

  // No prompt loaded via listPrompts should come from reference/
  assert(platformPrompts.every((p) => !p.filePath.includes("/reference/")), "no reference file parsed as prompt");
}

function testValidatePromptCountWarning(): void {
  // Build synthetic prompts that exceed MAX_TOTAL=6
  const synthetic: import("../../src/prompt-center").PromptDocument[] = [];
  for (let i = 1; i <= 7; i++) {
    synthetic.push({
      id: `X-0${i}`,
      title: `Synthetic ${i}`,
      layer: i <= 3 ? "sop" : "platform",
      priority: i,
      stability: "static",
      content: `content ${i}`,
      filePath: `/fake/X-0${i}.md`,
    });
  }

  const ctx = { runtime: "claude-code-cli" as const, stageType: "development" as const, roleName: "研发者" as const, conversationKind: "discussion" as const, ownerType: "workspace_stage" as const };

  // Capture console.warn
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => warnings.push(args.join(" "));

  try {
    // All 7 synthetic prompts match (no when filter), so activePromptIds.length = 7 > 6
    assembleSystemPrompt({ prompts: synthetic, matchContext: ctx, variables: {} });

    assert(warnings.some((w) => w.includes("总数 7") && w.includes("上限 6")), `should warn total > 6, got: ${warnings.join("; ")}`);
    // 4 sop (X-01..03 are sop? no, i<=3 is sop, so 3 sop + 4 platform = 7 total)
    // sop = 3, not > MAX_SOP(3), so no sop warning
    // platform = 4, not > MAX_PLATFORM(6), so no platform warning
    assert(!warnings.some((w) => w.includes("sop prompt 数")), "should not warn sop when sop=3");
    assert(!warnings.some((w) => w.includes("platform prompt 数")), "should not warn platform when platform=4");
  } finally {
    console.warn = origWarn;
  }

  // Test platform-specific warning
  const platformHeavy: import("../../src/prompt-center").PromptDocument[] = [];
  for (let i = 1; i <= 7; i++) {
    platformHeavy.push({
      id: `P-0${i}`,
      title: `Platform ${i}`,
      layer: "platform",
      priority: i,
      stability: "static",
      content: `content ${i}`,
      filePath: `/fake/P-0${i}.md`,
    });
  }

  const warnings2: string[] = [];
  console.warn = (...args: any[]) => warnings2.push(args.join(" "));

  try {
    assembleSystemPrompt({ prompts: platformHeavy, matchContext: ctx, variables: {} });
    assert(warnings2.some((w) => w.includes("platform prompt 数 7") && w.includes("上限 6")), `should warn platform > 6, got: ${warnings2.join("; ")}`);
    assert(warnings2.some((w) => w.includes("总数 7")), "should also warn total > 6");
  } finally {
    console.warn = origWarn;
  }
}

testPromptLayering();
testSkillDiscovery();
testMatchesWhen();
testAssemblyEngine();
testPromptRendering();
testSerializable();
testReferenceExclusion();
testValidatePromptCountWarning();

console.log("prompt-assets tests passed");