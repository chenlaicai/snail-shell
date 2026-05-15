import assert from "assert";
import fs from "fs";
import path from "path";
import { getPrompt, getSkill, listPrompts, listFrames, listSkills, renderPromptContent, renderPromptTemplate, buildFromFrame, getFrame, renderFrame } from "../../src/meta";

function testPromptRegistry(): void {
  const prompts = listPrompts();
  assert(prompts.some((prompt) => prompt.id === "S-02"), "history skill reference prompt should be discoverable");
  assert(prompts.some((prompt) => prompt.id === "S-05"), "task prompt should be discoverable");
  assert(prompts.some((prompt) => prompt.id === "B-01"), "AI identity and responsibility contract should be discoverable");
  assert(prompts.some((prompt) => prompt.id === "S-03"), "developer handbook should be discoverable from the same registry");
  assert(prompts.every((prompt) => /^[BS]-\d{2}$/.test(prompt.id)), "prompt ids should use B-/S- prefix with two-digit module number");
  assert(!prompts.some((prompt) => /^P\d{4}/.test(prompt.id)), "legacy P-number prompt ids should not remain");
  assert(prompts.every((prompt) => path.basename(prompt.filePath).startsWith(`${prompt.id}-`)), "prompt filenames should start with their id plus a readable title");
  assert(!prompts.some((prompt) => path.basename(prompt.filePath) === `${prompt.id}.md`), "prompt filenames should not be bare ids");
}

function testFrameRegistry(): void {
  const frames = listFrames();
  assert(frames.length >= 4, "should have at least 4 frames (F-01 through F-04)");
  assert(frames.some((f) => f.id === "F-01"), "F-01 project conversation frame should exist");
  assert(frames.some((f) => f.id === "F-02"), "F-02 knowledge governance frame should exist");
  assert(frames.some((f) => f.id === "F-03"), "F-03 mention extraction frame should exist");
  assert(frames.some((f) => f.id === "F-04"), "F-04 conversation summary frame should exist");
  assert(frames.every((f) => f.type === "frame"), "all frames should have type 'frame'");
  assert(frames.every((f) => typeof f.content === "string" && f.content.length > 0), "all frames should have content");

  const f01 = getFrame("F-01");
  assert(f01.content.includes("{{prompt:B-01}}"), "F-01 should reference B-01");
  assert(f01.content.includes("{{prompt:S-01}}"), "F-01 should reference S-01");
  assert(f01.content.includes("{{prompt:S-03}}"), "F-01 should reference S-03");
  assert(f01.content.includes("{{prompt:S-04}}"), "F-01 should reference S-04");
  assert(f01.content.includes("{{#when:"), "F-01 should have conditional sections");

  const f02 = getFrame("F-02");
  assert(f02.content.includes("知识治理上下文"), "F-02 should have knowledge governance section");
  assert(f02.content.includes("{{governance_id}}"), "F-02 should reference governance variables");

  const f03 = getFrame("F-03");
  assert(f03.content.includes("{{prompt:S-05}}"), "F-03 should reference S-05");

  const f04 = getFrame("F-04");
  assert(f04.content.includes("{{prompt:S-06}}"), "F-04 should reference S-06");
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
  assert(messageOut.content.includes("--mentions 'Implementation Snail'"), "message-out skill should show how to generate mentioned text payloads");
  assert(fs.existsSync(path.join(path.dirname(messageOut.filePath), "message-out.js")), "message-out skill should own its command wrapper script");
  const conversationHistory = getSkill("conversation-history");
  assert(conversationHistory.description.includes("更早历史消息"), "conversation-history skill should expose history lookup purpose");
  assert(conversationHistory.content.includes(".meta/skills/conversation-history/conversation-history"), "conversation-history skill should own the script usage details");
}

function testTaskFrameRendering(): void {
  const mentionFrame = getFrame("F-03");
  const summaryFrame = getFrame("F-04");
  const mentionContent = buildFromFrame(mentionFrame, {}, {});
  const summaryContent = buildFromFrame(summaryFrame, {}, {});
  assert(mentionContent.includes("## Mention 提取任务"), "mention extractor prompt should load from F-03 frame");
  assert(mentionContent.includes("被明确呼叫出来继续处理工作的 Snail"), "mention extractor prompt should preserve mention extraction semantics");
  assert(summaryContent.includes("## Conversation 摘要任务"), "conversation summary prompt should load from F-04 frame");
  assert(summaryContent.includes("内容选择"), "conversation summary prompt should preserve summary task semantics");
}

function testFrameTemplateRendering(): void {
  const f01 = getFrame("F-01");

  // With empty context, when blocks should be removed
  const emptyResult = renderFrame(f01, {}, {});
  assert(emptyResult.includes("身份与责任契约"), "F-01 should contain base section headings");
  assert(emptyResult.includes("项目上下文"), "F-01 should contain project context section");
  // When blocks with no matching context should be removed
  assert(!emptyResult.includes("研发者手册"), "F-01 should not contain dev handbook without matching context");
  assert(!emptyResult.includes("检视者手册"), "F-01 should not contain reviewer handbook without matching context");

  // With development stage + Implementation Snail, should include S-03
  const devResult = renderFrame(f01, { stageType: "development", snailName: "Implementation Snail" }, {});
  assert(devResult.includes("研发者手册"), "F-01 should contain dev handbook with dev stage + Impl snail");
  assert(!devResult.includes("检视者手册"), "F-01 should not contain reviewer handbook with dev stage");

  // With review stage + Acceptance Snail, should include S-04
  const reviewResult = renderFrame(f01, { stageType: "review", snailName: "Acceptance Snail" }, {});
  assert(reviewResult.includes("检视者手册"), "F-01 should contain reviewer handbook with review stage + Acceptance snail");
  assert(!reviewResult.includes("研发者手册"), "F-01 should not contain dev handbook with Acceptance snail");

  // With CLI runtime, should include B-03
  const cliResult = renderFrame(f01, { runtime: "claude-code-cli" }, {});
  assert(cliResult.includes("运行时边界"), "F-01 should contain runtime boundaries with CLI runtime");

  // F-02 with governance context
  const f02 = getFrame("F-02");
  const govResult = renderFrame(f02, { ownerType: "knowledge_governance" }, {});
  assert(govResult.includes("知识治理上下文"), "F-02 should contain governance context");
  assert(govResult.includes("身份与责任契约"), "F-02 should contain base sections");
}

function testPromptRendering(): void {
  const historyPrompt = getPrompt("S-02");
  const developerHandbook = getPrompt("S-03");
  const reviewerHandbook = getPrompt("S-04");
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

  // Developer handbook (S-03) - outline rendering
  const developerOutlineContent = renderPromptContent(developerHandbook, {});
  assert(developerOutlineContent.includes("当前身份：你是 Snail Shell 的研发者"), "developer handbook should own implementation identity");
  assert(developerOutlineContent.includes("目标不是机械执行用户文字"), "developer handbook should state role-oriented responsibility");
  assert(developerOutlineContent.includes("严禁默认采用\"最小修复\"") || developerOutlineContent.includes("严禁默认采用\u201c最小修复\u201d"), "developer handbook should reject default minimal fixes");
  assert(developerOutlineContent.includes("必须先完成全链路影响分析"), "developer handbook should require full-chain impact analysis");
  assert(developerOutlineContent.includes("修改既有逻辑前，先理解原逻辑服务的场景"), "developer handbook should require considering existing scenarios before changes");

  // Reviewer handbook (S-04) - outline rendering
  const reviewerOutlineContent = renderPromptContent(reviewerHandbook, {});
  assert(reviewerOutlineContent.includes("当前身份：你是 Snail Shell 的 PR 检视者"), "reviewer handbook should own reviewer identity");

  // Base prompts - full rendering
  const baseContent = renderPromptContent(getPrompt("B-01"), {});
  assert(baseContent.includes("### 用户决策边界"), "base contract should group user decision rules structurally");
  assert(baseContent.includes("必须通过 `message-out` mention 协议声明目标 Snail"), "base contract should route cross-snail work through message-out mentions");
  assert(baseContent.includes("与用户交互时使用中文"), "base contract should include Chinese language rule");

  const knowledgeContent = renderPromptContent(getPrompt("B-02"), {});
  assert(knowledgeContent.includes("### 触发规则"), "knowledge candidate prompt should separate triggers from boundaries");

  const transcriptContent = renderPromptContent(getPrompt("B-03"), {});
  assert(transcriptContent.includes("### 读取规则"), "runtime boundary prompt should separate reading rules from prohibitions");

  const projectContextContent = renderPromptContent(getPrompt("S-01"), {});
  assert(projectContextContent.includes("### 输入归属规则"), "project context should structure input ownership rules");

  const historyContent = renderPromptContent(getPrompt("S-02"), {
    history_script_path: "/tmp/history-script",
    db_path: "/tmp/snail.db",
    conversation_id: "conv-123",
    history_search_example: "search example",
    history_window_example: "window example",
    history_by_ids_example: "by-ids example",
  });
  assert(historyContent.includes("### 使用边界"), "history prompt should separate examples from usage boundaries");

  const templateContent = fs.readFileSync(path.join(process.cwd(), ".meta", "prompts", "_template-prompt.md"), "utf8");
  assert(templateContent.includes("S-99") || templateContent.includes("示例"), "prompt template should guide new prompt creation");

  const structureDoc = fs.readFileSync(path.join(process.cwd(), "docs", "core", "prompt-system-structure.md"), "utf8");
  assert(structureDoc.includes("两层模型") || structureDoc.includes("Base 层") || structureDoc.includes("B-"), "prompt structure doc should define architecture");
}

function testPromptMetadataIsSerializable(): void {
  const prompts = listPrompts();
  const serialized = JSON.parse(JSON.stringify(prompts)) as ReturnType<typeof listPrompts>;
  const introPrompt = serialized.find((prompt) => prompt.id === "S-01");
  assert(introPrompt, "prompt metadata should serialize for UI APIs");
  assert(typeof introPrompt.content === "string" && introPrompt.content.length > 0, "serialized prompt should include content");
  assert(typeof introPrompt.filePath === "string" && introPrompt.filePath.includes(".meta"), "serialized prompt should include source path");
}

function testFrameMetadataIsSerializable(): void {
  const frames = listFrames();
  const serialized = JSON.parse(JSON.stringify(frames)) as ReturnType<typeof listFrames>;
  const f01 = serialized.find((f) => f.id === "F-01");
  assert(f01, "frame metadata should serialize for UI APIs");
  assert(typeof f01.content === "string" && f01.content.length > 0, "serialized frame should include content");
  assert(typeof f01.filePath === "string" && f01.filePath.includes(".meta"), "serialized frame should include source path");
}

testPromptRegistry();
testFrameRegistry();
testSkillDiscovery();
testTaskFrameRendering();
testFrameTemplateRendering();
testPromptRendering();
testPromptMetadataIsSerializable();
testFrameMetadataIsSerializable();

console.log("prompt-assets tests passed");
