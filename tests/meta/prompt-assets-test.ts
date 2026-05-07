import assert from "assert";
import fs from "fs";
import path from "path";
import { getPromptDocument, getSkill, getTaskPrompt, listPromptDocuments, listPromptDocumentsForTarget, listSkills, renderPromptContent, renderPromptOutline, renderPromptTemplate } from "../../src/meta";

function testPromptRegistry(): void {
  const prompts = listPromptDocuments();
  assert(prompts.some((prompt) => prompt.id === "SYS-CONV-HISTORY"), "history prompt should be discoverable");
  assert(prompts.some((prompt) => prompt.id === "SYS-SNAIL-IMPLEMENTATION"), "snail profile prompt should be discoverable");
  assert(prompts.some((prompt) => prompt.id === "TASK-MENTION-EXTRACTOR"), "task prompt should be discoverable");
  assert(prompts.some((prompt) => prompt.id === "PRM-GLOBAL-IMPLEMENTATION-EXECUTION"), "global prompt should be discoverable from the same registry");
}

function testTargetRegistrySelection(): void {
  const scenePrompts = listPromptDocumentsForTarget({ target: "conversation.system" });
  const matchedGlobalPrompts = listPromptDocumentsForTarget({
    target: "conversation.system.global",
    stageType: "development",
    snailName: "Implementation Snail",
    repoRelated: true,
  });
  const unmatchedRepoPrompts = listPromptDocumentsForTarget({
    target: "conversation.system.global",
    stageType: "development",
    snailName: "Implementation Snail",
    repoRelated: false,
  });
  assert(scenePrompts.length > 0, "conversation target prompts should be discoverable from registry");
  assert(scenePrompts[0]?.id === "SYS-CONV-INTRO", "conversation target prompts should be sorted by metadata order");
  assert(scenePrompts.some((prompt) => prompt.inject_matched_prompts === true), "scene prompts should declare global prompt injection through metadata");
  assert(scenePrompts.some((prompt) => prompt.skill_references?.some((skill) => skill.id === "message-out" && skill.mode === "required")), "scene prompts should declare required skill references through metadata");
  assert(scenePrompts.some((prompt) => prompt.skill_references?.some((skill) => skill.id === "knowledge-activation" && skill.mode === "conditional")), "scene prompts should declare conditional knowledge activation skill references");
  assert(!scenePrompts.some((prompt) => prompt.skill_references?.some((skill) => skill.id === "coding-workflow" || skill.id === "ask-user" || skill.id === "code-style-review")), "pure prompt rules should not be exposed as skills");
  assert(matchedGlobalPrompts.some((prompt) => prompt.id === "PRM-GLOBAL-IMPLEMENTATION-EXECUTION"), "matched global prompts should come from the same registry");
  assert(!unmatchedRepoPrompts.some((prompt) => prompt.id === "PRM-GLOBAL-REPO-WORKTREE"), "repo-only prompts should not match when repoRelated is false");
}

function testSkillDiscovery(): void {
  const skills = listSkills();
  assert(skills.some((skill) => skill.name === "message-out"), "message-out skill should be discoverable");
  assert(skills.some((skill) => skill.name === "knowledge-activation"), "knowledge activation skill should be discoverable");
  assert(!skills.some((skill) => skill.name === "ask-user" || skill.name === "coding-workflow" || skill.name === "code-style-review"), "prompt-only behavior rules should not be registered as skills");
  const messageOut = getSkill("message-out");
  assert(messageOut.description.includes("消息内容块"), "message-out skill should expose description from SKILL.md frontmatter");
  assert(messageOut.content.includes("# Message Out Protocol"), "message-out skill content should be readable from SKILL.md");
  assert(messageOut.content.includes("需要其他 Snail 继续处理"), "message-out skill should define when cross-snail work requires mentions");
  assert(messageOut.content.includes('"mentions":["Implementation Snail"]'), "message-out skill should show how to generate mentioned text payloads");
  assert(fs.existsSync(path.join(path.dirname(messageOut.filePath), "message-out.js")), "message-out skill should own its command wrapper script");
  const knowledgeActivation = getSkill("knowledge-activation");
  assert(knowledgeActivation.description.includes("动态提示词、skill、MCP/tool、checker"), "knowledge activation skill should expose multi-route activation purpose");
  assert(knowledgeActivation.content.includes("prompt 注入只是动态生效的一种方式"), "knowledge activation skill should reject prompt-only activation");
  assert(knowledgeActivation.content.includes("Static Activation Workflow"), "knowledge activation skill should define static activation workflow");
}

function testTaskPromptLoading(): void {
  const mentionPrompt = getTaskPrompt("task.mention-extractor.system");
  const summaryPrompt = getTaskPrompt("task.conversation-summary.system");
  assert(mentionPrompt.includes("提取所有被呼叫出来干活的对象"), "mention extractor prompt should load from task prompt assets");
  assert(summaryPrompt.includes("历史对话摘要模块"), "conversation summary prompt should load from task prompt assets");
}

function testPromptRendering(): void {
  const historyPrompt = getPromptDocument("SYS-CONV-HISTORY");
  const globalPrompt = getPromptDocument("PRM-GLOBAL-REPO-WORKTREE");
  const implementationPrompt = getPromptDocument("PRM-GLOBAL-IMPLEMENTATION-EXECUTION");
  const reviewPrompt = getPromptDocument("PRM-GLOBAL-REVIEW-REPORTING");
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
  const outline = renderPromptOutline(globalPrompt);
  assert(outline.some((line) => line.includes("worktree")), "outline rendering should extract bullet focus points from global prompts");
  const outlineContent = renderPromptContent(globalPrompt, {});
  assert(outlineContent.includes("- 必须基于最新 `origin/main` 创建隔离 worktree。"), "renderPromptContent should honor outline render_mode");
  const implementationOutlineContent = renderPromptContent(implementationPrompt, {});
  assert(implementationOutlineContent.includes("严禁默认采用“最小修复”"), "implementation prompt should reject default minimal fixes");
  assert(implementationOutlineContent.includes("完成完整修复"), "implementation prompt should require complete fixes");
  assert(implementationOutlineContent.includes("commit 标题必须使用中文"), "implementation prompt should require Chinese commit titles");
  assert(implementationOutlineContent.includes("PR 标题和正文必须使用中文"), "implementation prompt should require Chinese PR titles and bodies");
  assert(implementationOutlineContent.includes("`/** ... */` 形式的正式注释"), "implementation prompt should require formal why-focused code comments");
  assert(implementationOutlineContent.includes("不能只针对新发现的问题做单点修补"), "implementation prompt should require considering existing scenarios before changes");
  assert(implementationOutlineContent.includes("PR 信息只服务本次修改的评审"), "implementation prompt should keep PR information separate from durable code comments");
  assert(implementationOutlineContent.includes("提交 PR 前必须自检本次代码改动是否包含关键不变量"), "implementation prompt should require pre-PR code comment coverage checks");
  assert(implementationOutlineContent.includes("判断无需新增注释时应在 PR 说明或交付记录中说明理由"), "implementation prompt should require explaining when no code comments are needed");
  assert(implementationOutlineContent.includes("在研发阶段不要 @Acceptance Snail"), "implementation prompt should avoid review mentions during development");
  assert(implementationOutlineContent.includes("`Implementation Snail`"), "implementation PR comments should include concrete role signature guidance");
  assert(implementationOutlineContent.includes("最后一行的行尾"), "implementation PR comments should place signatures at the end of the last line");
  const reviewOutlineContent = renderPromptContent(reviewPrompt, {});
  assert(reviewOutlineContent.includes("`Acceptance Snail`"), "review PR comments should include concrete role signature guidance");
  assert(reviewOutlineContent.includes("最后一行的行尾"), "review PR comments should place signatures at the end of the last line");
  assert(reviewOutlineContent.includes("虽然有少量注释但关键不变量"), "review prompt should catch insufficient comment coverage, not only missing comments");
  assert(reviewOutlineContent.includes("不能因为已有 feature 文档或 PR 说明就跳过代码级注释要求"), "review prompt should not let docs replace durable code comments");
  assert(reviewOutlineContent.includes("message-out"), "review conclusions should use message-out mention protocol");
  assert(reviewOutlineContent.includes("Implementation Snail"), "review conclusions should explicitly route back to implementation snail");
  const snailContextContent = renderPromptContent(getPromptDocument("SYS-CONV-SNAIL"), {});
  assert(snailContextContent.includes("必须遵循 `message-out` mention 协议声明目标 Snail"), "snail context should route cross-snail work through message-out mentions");
  assert(!snailContextContent.includes("自然文本 @<Snail Name>"), "snail context should not expose natural @ fallback extraction to agents");
  assert(!snailContextContent.includes("兼容识别"), "snail context should not describe fallback mention extraction to agents");
  assert(!snailContextContent.includes("只能使用该 Snail 的唯一 name 进行 @"), "snail context should not make natural @ the sole cross-snail routing rule");
}

function testPromptMetadataIsSerializable(): void {
  const prompts = listPromptDocuments();
  const serialized = JSON.parse(JSON.stringify(prompts)) as ReturnType<typeof listPromptDocuments>;
  const introPrompt = serialized.find((prompt) => prompt.id === "SYS-CONV-INTRO");
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
