import assert from "assert";
import { getAssembly, getSkill, getSystemPromptAsset, getTaskPrompt, listSkills, listSystemPromptAssets, renderTemplate } from "../../src/meta";

function testSystemPromptAssets(): void {
  const assets = listSystemPromptAssets();
  assert(assets.some((asset) => asset.id === "ASM-CONVERSATION-SYSTEM" && asset.kind === "assembly"), "conversation assembly should be discoverable");
  assert(assets.some((asset) => asset.id === "SYS-CONV-HISTORY" && asset.kind === "section"), "history system section should be discoverable");
  assert(assets.some((asset) => asset.id === "SYS-SNAIL-IMPLEMENTATION" && asset.kind === "snail-profile"), "snail profile assets should be discoverable");
  assert(assets.some((asset) => asset.id === "TASK-MENTION-EXTRACTOR" && asset.kind === "task-prompt"), "task prompt assets should be discoverable");
}

function testAssemblyStructure(): void {
  const assembly = getAssembly("conversation.system");
  assert(Array.isArray(assembly.includes) && assembly.includes.includes("SYS-CONV-GLOBAL"), "assembly should include global system section");
  assert(assembly.include_matched_regulations === true, "assembly should enable matched regulation injection");
  assert(Array.isArray(assembly.skills) && assembly.skills.some((skill) => skill.id === "message-out" && skill.mode === "required"), "assembly should require message-out skill reference");
}

function testSkillDiscovery(): void {
  const skills = listSkills();
  assert(skills.some((skill) => skill.name === "message-out"), "message-out skill should be discoverable");
  assert(skills.some((skill) => skill.name === "ask-user"), "ask-user skill should be discoverable");
  const messageOut = getSkill("message-out");
  assert(messageOut.description.includes("正式消息"), "message-out skill should expose description from SKILL.md frontmatter");
  assert(messageOut.content.includes("# Message Out Protocol"), "message-out skill content should be readable from SKILL.md");
}

function testTaskPromptLoading(): void {
  const mentionPrompt = getTaskPrompt("task.mention-extractor.system");
  const summaryPrompt = getTaskPrompt("task.conversation-summary.system");
  assert(mentionPrompt.includes("提取所有被呼叫出来干活的对象"), "mention extractor prompt should load from task prompt assets");
  assert(summaryPrompt.includes("历史对话摘要模块"), "conversation summary prompt should load from task prompt assets");
}

function testTemplateRendering(): void {
  const historyAsset = getSystemPromptAsset("SYS-CONV-HISTORY");
  const rendered = renderTemplate(historyAsset.content, {
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
}

testSystemPromptAssets();
testAssemblyStructure();
testSkillDiscovery();
testTaskPromptLoading();
testTemplateRendering();

console.log("prompt-assets tests passed");
