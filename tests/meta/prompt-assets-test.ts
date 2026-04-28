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
  assert(!scenePrompts.some((prompt) => prompt.skill_references?.some((skill) => skill.id === "coding-workflow" || skill.id === "ask-user" || skill.id === "code-style-review")), "pure prompt rules should not be exposed as skills");
  assert(matchedGlobalPrompts.some((prompt) => prompt.id === "PRM-GLOBAL-IMPLEMENTATION-EXECUTION"), "matched global prompts should come from the same registry");
  assert(!unmatchedRepoPrompts.some((prompt) => prompt.id === "PRM-GLOBAL-REPO-WORKTREE"), "repo-only prompts should not match when repoRelated is false");
}

function testSkillDiscovery(): void {
  const skills = listSkills();
  assert(skills.some((skill) => skill.name === "message-out"), "message-out skill should be discoverable");
  assert(!skills.some((skill) => skill.name === "ask-user" || skill.name === "coding-workflow" || skill.name === "code-style-review"), "prompt-only behavior rules should not be registered as skills");
  const messageOut = getSkill("message-out");
  assert(messageOut.description.includes("正式消息"), "message-out skill should expose description from SKILL.md frontmatter");
  assert(messageOut.content.includes("# Message Out Protocol"), "message-out skill content should be readable from SKILL.md");
  assert(fs.existsSync(path.join(path.dirname(messageOut.filePath), "message-out.js")), "message-out skill should own its command wrapper script");
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
}

testPromptRegistry();
testTargetRegistrySelection();
testSkillDiscovery();
testTaskPromptLoading();
testPromptRendering();

console.log("prompt-assets tests passed");
