import assert from "assert";
import fs from "fs";
import path from "path";
import { getPromptDocument, getSkill, getTaskPrompt, listPromptDocuments, listPromptDocumentsForTarget, listSkills, renderPromptContent, renderPromptOutline, renderPromptTemplate } from "../../src/meta";

function testPromptRegistry(): void {
  const prompts = listPromptDocuments();
  assert(prompts.some((prompt) => prompt.id === "P010107"), "history skill reference prompt should be discoverable");
  const serialized = JSON.parse(JSON.stringify(prompts)) as Array<{ semantic_layer?: string; id: string }>;
  assert(!serialized.some((prompt) => prompt.semantic_layer === "snail_profile"), "snail profiles should not remain as a detached prompt layer");
  assert(!prompts.some((prompt) => prompt.id.startsWith("SYS-SNAIL-")), "snail profile prompt assets should be folded into stage role playbooks or participant context");
  assert(prompts.some((prompt) => prompt.id === "P0201"), "task prompt should be discoverable");
  assert(prompts.some((prompt) => prompt.id === "P0004"), "AI judgment contract prompt should be discoverable");
  assert(prompts.some((prompt) => prompt.id === "P010201"), "stage role playbook should be discoverable from the same registry");
  assert(prompts.every((prompt) => /^P\d{4}(\d{2})?$/.test(prompt.id)), "prompt ids should use layered numeric P ids without internal dashes");
  assert(!prompts.some((prompt) => /^P-/.test(prompt.id)), "prompt ids should not keep dashed numeric prefixes");
  assert(!prompts.some((prompt) => /[A-Z]{2,}-[A-Z]/.test(prompt.id.replace(/^P/, ""))), "prompt ids should not use long English semantic prefixes");
  assert(prompts.every((prompt) => path.basename(prompt.filePath).startsWith(`${prompt.id}-`)), "prompt filenames should start with their numeric id plus a readable title");
  assert(!prompts.some((prompt) => path.basename(prompt.filePath) === `${prompt.id}.md`), "prompt filenames should not be bare numeric ids");
  assert(!prompts.some((prompt) => prompt.target === "conversation.system.global"), "deprecated global injection target should not remain");
  assert(!prompts.some((prompt) => prompt.inject_matched_prompts === true), "prompt injection bridge should not remain");
}

function testTargetRegistrySelection(): void {
  const basePrompts = listPromptDocumentsForTarget({ target: "ai.base.system" });
  const workContextPrompts = listPromptDocumentsForTarget({ target: "scenario.project-conversation.work-context" });
  const matchedPlaybooks = listPromptDocumentsForTarget({
    target: "scenario.project-conversation.stage-role-playbook",
    stageType: "development",
    snailName: "Implementation Snail",
    repoRelated: true,
  });
  const unmatchedRepoPrompts = listPromptDocumentsForTarget({
    target: "scenario.project-conversation.stage-role-playbook",
    stageType: "development",
    snailName: "Implementation Snail",
    repoRelated: false,
  });
  const implementationReviewPrompts = listPromptDocumentsForTarget({
    target: "scenario.project-conversation.stage-role-playbook",
    stageType: "review",
    snailName: "Implementation Snail",
    repoRelated: true,
  });
  assert(basePrompts.length > 0, "base prompts should be discoverable from registry");
  assert(basePrompts[0]?.id === "P0001", "base prompts should be sorted by metadata order");
  assert(basePrompts.some((prompt) => prompt.id === "P0004"), "AI judgment contract should live in base prompts");
  assert(basePrompts.some((prompt) => prompt.skill_references?.some((skill) => skill.id === "message-out" && skill.mode === "required")), "base prompts should declare required skill references through metadata");
  assert(!basePrompts.some((prompt) => prompt.id.includes("HISTORY")), "history lookup should not live in AI base prompts");
  assert(workContextPrompts.length > 0, "project conversation work context prompts should be discoverable from registry");
  assert(workContextPrompts[0]?.id === "P010101", "work context prompts should be sorted by metadata order");
  assert(workContextPrompts.some((prompt) => prompt.id === "P010107" && prompt.skill_references?.some((skill) => skill.id === "conversation-history")), "project conversation should reference conversation-history as a skill capability");
  assert(!basePrompts.concat(workContextPrompts).some((prompt) => prompt.skill_references?.some((skill) => skill.id === "coding-workflow" || skill.id === "ask-user" || skill.id === "code-style-review")), "pure prompt rules should not be exposed as skills");
  assert(matchedPlaybooks.some((prompt) => prompt.id === "P010201"), "matched playbooks should come from the same registry");
  assert(!matchedPlaybooks.some((prompt) => prompt.id === "P010202"), "development stage should not inject implementation review playbook");
  assert(implementationReviewPrompts.some((prompt) => prompt.id === "P010202"), "review stage should inject implementation review playbook");
  assert(!implementationReviewPrompts.some((prompt) => prompt.id === "P010201"), "review stage should not inject development playbook");
  assert(!unmatchedRepoPrompts.some((prompt) => prompt.id === "P010204"), "repo-only prompts should not match when repoRelated is false");
}

function testSkillDiscovery(): void {
  const skills = listSkills();
  assert(skills.some((skill) => skill.name === "message-out"), "message-out skill should be discoverable");
  assert(skills.some((skill) => skill.name === "conversation-history"), "conversation-history skill should be discoverable");
  assert(!skills.some((skill) => skill.name === "ask-user" || skill.name === "coding-workflow" || skill.name === "code-style-review"), "prompt-only behavior rules should not be registered as skills");
  const messageOut = getSkill("message-out");
  assert(messageOut.description.includes("消息内容块"), "message-out skill should expose description from SKILL.md frontmatter");
  assert(messageOut.content.includes("# Message Out Protocol"), "message-out skill content should be readable from SKILL.md");
  assert(messageOut.content.includes("需要其他 Snail 继续处理"), "message-out skill should define when cross-snail work requires mentions");
  assert(messageOut.content.includes('"mentions":["Implementation Snail"]'), "message-out skill should show how to generate mentioned text payloads");
  assert(fs.existsSync(path.join(path.dirname(messageOut.filePath), "message-out.js")), "message-out skill should own its command wrapper script");
  const conversationHistory = getSkill("conversation-history");
  assert(conversationHistory.description.includes("更早历史消息"), "conversation-history skill should expose history lookup purpose");
  assert(conversationHistory.content.includes(".meta/scripts/conversation-history"), "conversation-history skill should own the script usage details");
}

function testTaskPromptLoading(): void {
  const mentionPrompt = getTaskPrompt("task.mention-extractor.system");
  const summaryPrompt = getTaskPrompt("task.conversation-summary.system");
  assert(mentionPrompt.includes("提取所有被呼叫出来干活的对象"), "mention extractor prompt should load from task prompt assets");
  assert(summaryPrompt.includes("历史对话摘要模块"), "conversation summary prompt should load from task prompt assets");
}

function testPromptRendering(): void {
  const historyPrompt = getPromptDocument("P010107");
  const repoPrompt = getPromptDocument("P010204");
  const implementationPrompt = getPromptDocument("P010201");
  const implementationReviewPrompt = getPromptDocument("P010202");
  const reviewPrompt = getPromptDocument("P010203");
  const rendered = renderPromptTemplate(historyPrompt.content, {
    history_script_path: "/tmp/history-script",
    db_path: "/tmp/snail.db",
    conversation_id: "conv-123",
    history_search_example: "search example",
    history_window_example: "window example",
    history_by_ids_example: "by-ids example",
  });
  assert(rendered.includes("/tmp/history-script"), "template rendering should substitute history script path");
  assert(rendered.includes("conv-123"), "template rendering should substitute conversation id");
  assert(rendered.includes("search example"), "template rendering should substitute example strings");
  const outline = renderPromptOutline(repoPrompt);
  assert(outline.some((line) => line.includes("worktree")), "outline rendering should extract bullet focus points from stage role playbooks");
  const outlineContent = renderPromptContent(repoPrompt, {});
  assert(outlineContent.includes("- 必须基于最新 `origin/main` 创建隔离 worktree。"), "renderPromptContent should honor outline render_mode");
  const implementationOutlineContent = renderPromptContent(implementationPrompt, {});
  assert(implementationOutlineContent.includes("严禁默认采用“最小修复”"), "implementation prompt should reject default minimal fixes");
  assert(implementationOutlineContent.includes("当前身份：你是 Snail Shell 的研发者"), "implementation stage playbook should own implementation identity");
  assert(implementationOutlineContent.includes("完成完整修复"), "implementation prompt should require complete fixes");
  assert(implementationOutlineContent.includes("commit 标题必须使用中文"), "implementation prompt should require Chinese commit titles");
  assert(implementationOutlineContent.includes("PR 标题和正文必须使用中文"), "implementation prompt should require Chinese PR titles and bodies");
  assert(implementationOutlineContent.includes("`/** ... */` 形式的正式注释"), "implementation prompt should require formal why-focused code comments");
  assert(implementationOutlineContent.includes("不能只针对新发现的问题做单点修补"), "implementation prompt should require considering existing scenarios before changes");
  assert(implementationOutlineContent.includes("PR 信息只服务本次修改的评审"), "implementation prompt should keep PR information separate from durable code comments");
  assert(implementationOutlineContent.includes("提交 PR 前必须自检本次代码改动是否包含关键不变量"), "implementation prompt should require pre-PR code comment coverage checks");
  assert(implementationOutlineContent.includes("判断无需新增注释时应在 PR 说明或交付记录中说明理由"), "implementation prompt should require explaining when no code comments are needed");
  assert(implementationOutlineContent.includes("提交 PR 后只记录 PR 状态并等待系统推进 Stage"), "development prompt should stop after PR delivery and stage handoff");
  assert(implementationOutlineContent.includes("不能根据“PR 已提交”自行推断已进入 review"), "implementation prompt should not infer review stage from submitted PRs");
  assert(!implementationOutlineContent.includes("才主动 @Acceptance Snail 检视 PR"), "development prompt should not include review-stage mention action");
  const implementationReviewOutlineContent = renderPromptContent(implementationReviewPrompt, {});
  assert(implementationReviewOutlineContent.includes("系统注入的 `当前 Stage` 明确为 review"), "implementation review prompt should bind review behavior to injected stage context");
  assert(implementationReviewOutlineContent.includes("才主动 @Acceptance Snail 检视 PR"), "implementation review prompt should own the review-stage mention action");
  assert(implementationReviewOutlineContent.includes("对检视意见逐条判断"), "implementation review prompt should own review comment handling");
  assert(implementationReviewOutlineContent.includes("`Implementation Snail`"), "implementation review PR comments should include concrete role signature guidance");
  assert(implementationReviewOutlineContent.includes("最后一行的行尾"), "implementation review PR comments should place signatures at the end of the last line");
  const reviewOutlineContent = renderPromptContent(reviewPrompt, {});
  assert(reviewOutlineContent.includes("当前身份：你是 Snail Shell 的 PR 检视者"), "acceptance review playbook should own reviewer identity");
  assert(reviewOutlineContent.includes("`Acceptance Snail`"), "review PR comments should include concrete role signature guidance");
  assert(reviewOutlineContent.includes("最后一行的行尾"), "review PR comments should place signatures at the end of the last line");
  assert(reviewOutlineContent.includes("虽然有少量注释但关键不变量"), "review prompt should catch insufficient comment coverage, not only missing comments");
  assert(reviewOutlineContent.includes("不能因为已有 feature 文档或 PR 说明就跳过代码级注释要求"), "review prompt should not let docs replace durable code comments");
  assert(reviewOutlineContent.includes("message-out"), "review conclusions should use message-out mention protocol");
  assert(reviewOutlineContent.includes("Implementation Snail"), "review conclusions should explicitly route back to implementation snail");
  const baseContent = renderPromptContent(getPromptDocument("P0001"), {});
  assert(baseContent.includes("必须通过 `message-out` mention 协议声明目标 Snail"), "base contract should route cross-snail work through message-out mentions");
  const judgmentContent = renderPromptContent(getPromptDocument("P0004"), {});
  assert(judgmentContent.includes("不是被动文本转换器或命令执行器"), "judgment contract should make AI responsible for its own reasoning");
  assert(judgmentContent.includes("不是自动成立的事实、结论或方案"), "judgment contract should treat inputs as evidence rather than conclusions");
  assert(judgmentContent.includes("表层表达、可见症状、事实缺口、业务语义、流程边界、系统模型还是长期规则"), "judgment contract should require classifying the problem level");
  assert(judgmentContent.includes("不能用测试通过、文档齐全、流程完成、代码无明显缺陷等载体验收替代语义有效性判断"), "judgment contract should not let carrier-level checks replace semantic validation");
  const snailContextContent = renderPromptContent(getPromptDocument("P010105"), {});
  assert(!snailContextContent.includes("自然文本 @<Snail Name>"), "snail context should not expose natural @ fallback extraction to agents");
  assert(!snailContextContent.includes("兼容识别"), "snail context should not describe fallback mention extraction to agents");
  assert(!snailContextContent.includes("只能使用该 Snail 的唯一 name 进行 @"), "snail context should not make natural @ the sole cross-snail routing rule");
}

function testPromptMetadataIsSerializable(): void {
  const prompts = listPromptDocuments();
  const serialized = JSON.parse(JSON.stringify(prompts)) as ReturnType<typeof listPromptDocuments>;
  const introPrompt = serialized.find((prompt) => prompt.id === "P010101");
  assert(introPrompt, "prompt metadata should serialize for UI APIs");
  assert(typeof introPrompt.content === "string" && introPrompt.content.length > 0, "serialized prompt should include content");
  assert(typeof introPrompt.filePath === "string" && introPrompt.filePath.includes(".meta"), "serialized prompt should include source path");
}

testPromptRegistry();
testTargetRegistrySelection();
testSkillDiscovery();
testTaskPromptLoading();
testPromptRendering();
testPromptMetadataIsSerializable();

console.log("prompt-assets tests passed");
