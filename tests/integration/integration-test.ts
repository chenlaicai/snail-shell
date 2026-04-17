import fs from "fs";
import { PartType } from "../../src/persistence/store";
import http from "http";
import path from "path";
import { execFileSync } from "child_process";
import type { AgentEvent, AgentMessage, AgentRuntime, SnailRuntime, SnailRuntimeTurnInput } from "../../src/agent/interface";
import { RuntimeSnailAgentResolver } from "../../src/agent/resolver";
import { buildStatefulIncrementalMessages } from "../../src/agent/prompt-mapper";
import { createServer } from "../../src/api/server";
import type { ConversationSummaryGenerator, ConversationSummaryInput, MentionExtractionInput, MentionExtractionResult, MentionExtractor } from "../../src/llm";
import { ConversationStore } from "../../src/persistence/store";
import { ProjectManager } from "../../src/project/manager";
import { SnailRegistry } from "../../src/snails";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

class MockAgent implements SnailRuntime {
  readonly name = "mock";
  readonly runtime: AgentRuntime;
  lastMessages: AgentMessage[] = [];
  lastIncrementalMessages: AgentMessage[] = [];
  lastSystemPrompt?: string;
  emitSyntheticToolUse = false;
  invocationCount = 0;
  customReplyFn?: (context: {
    sessionId?: string | null;
    currentSnail: string;
    forcedWrapUp: boolean;
    lastUserContent: string;
    latestAssistantContent: string | null;
  }) => { content: string; sessionId?: string | null };

  constructor(runtime: "claude-code-cli" | "opencode-cli") {
    this.runtime = runtime;
  }

  setCustomReply(fn: (context: {
    sessionId?: string | null;
    currentSnail: string;
    forcedWrapUp: boolean;
    lastUserContent: string;
    latestAssistantContent: string | null;
  }) => { content: string; sessionId?: string | null }): void {
    this.customReplyFn = fn;
  }

  async invokeTurn(input: SnailRuntimeTurnInput, onEvent: (event: AgentEvent) => void): Promise<{ content: string; sessionId?: string | null }> {
    this.invocationCount += 1;
    const context = this.buildContext(input);

    if (this.emitSyntheticToolUse) {
      onEvent({ type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "/tmp/example.md" } });
      onEvent({ type: "result", content: "tool-backed reply" });
      return { content: "tool-backed reply", sessionId: context.sessionId };
    }

    const reply = this.customReplyFn ? this.customReplyFn(context) : this.computeReply(context);
    onEvent({ type: "result", content: reply.content });
    return reply;
  }

  private buildContext(input: SnailRuntimeTurnInput): {
    sessionId?: string | null;
    currentSnail: string;
    forcedWrapUp: boolean;
    lastUserContent: string;
    latestAssistantContent: string | null;
  } {
    const messages = input.history;
    const systemPrompt = input.systemPrompts.conversation;
    this.lastMessages = messages;
    this.lastIncrementalMessages = buildStatefulIncrementalMessages(input);
    this.lastSystemPrompt = systemPrompt;

    const lastUserMsg = [...messages].reverse().find((message) => message.role === "user");
    const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
    const runtimeSession = input.conversation.runtime_sessions[input.snail.name]?.sessionId;

    // Extract actual user content by removing "USER:\n" prefix
    const rawUserContent = lastUserMsg?.content ?? "hello";
    console.log("Raw user content:", rawUserContent);
    const userContent = rawUserContent.startsWith("USER:\n")
      ? rawUserContent.slice(6) // Remove "USER:\n" prefix
      : rawUserContent;
    console.log("Extracted user content:", userContent);

    return {
      sessionId: this.runtime === "opencode-cli" ? (runtimeSession ?? "ses_mock") : undefined,
      currentSnail: systemPrompt?.match(/当前响应 Snail: (.+)/)?.[1]?.trim() ?? "Owner Snail",
      forcedWrapUp: systemPrompt?.includes("当前处于最终收口阶段") ?? false,
      lastUserContent: userContent,
      latestAssistantContent: latestAssistant?.content ?? null,
    };
  }

  private computeReply(context: {
    sessionId?: string | null;
    currentSnail: string;
    forcedWrapUp: boolean;
    lastUserContent: string;
    latestAssistantContent: string | null;
  }): { content: string; sessionId?: string | null } {
    if (context.forcedWrapUp) {
      return { content: `${context.currentSnail} final summary without further handoff`, sessionId: context.sessionId };
    }

    if (context.lastUserContent.includes("@Owner Snail hello owner")) {
      return { content: "Owner Snail first reply", sessionId: context.sessionId };
    }

    if (context.lastUserContent.includes("handoff please")) {
      return {
        content: JSON.stringify({ content: "@Product Snail please continue from here", mentions: ["Product Snail"] }),
        sessionId: context.sessionId
      };
    }

    if (context.lastUserContent.includes("@Implementation Snail")) {
      return context.currentSnail === "Owner Snail"
        ? {
            content: JSON.stringify({ content: "@Implementation Snail please continue with implementation", mentions: ["Implementation Snail"] }),
            sessionId: context.sessionId
          }
        : { content: `${context.currentSnail} implementation response`, sessionId: context.sessionId };
    }

    if (context.lastUserContent.includes("@Acceptance Snail")) {
      return context.currentSnail === "Owner Snail"
        ? {
            content: JSON.stringify({ content: "@Acceptance Snail please continue with acceptance", mentions: ["Acceptance Snail"] }),
            sessionId: context.sessionId
          }
        : { content: `${context.currentSnail} acceptance response`, sessionId: context.sessionId };
    }

    if (context.latestAssistantContent?.includes("@Product Snail please continue from here")) {
      return {
        content: JSON.stringify({ content: "@Owner Snail continue the collaboration", mentions: ["Owner Snail"] }),
        sessionId: context.sessionId
      };
    }

    if (context.latestAssistantContent?.includes("@Owner Snail continue the collaboration")) {
      return {
        content: JSON.stringify({ content: "@Product Snail wrap this up", mentions: ["Product Snail"] }),
        sessionId: context.sessionId
      };
    }

    return { content: `echo: ${context.lastUserContent}`, sessionId: context.sessionId };
  }
}

class MockSummaryGenerator implements ConversationSummaryGenerator {
  async generateConversationSummary(input: ConversationSummaryInput): Promise<string> {
    const previousOverviewMatch = input.previousSummary.match(/## 会话概览\s*([\s\S]*?)(?:\n## |$)/);
    const previousOverview = previousOverviewMatch?.[1]?.trim();
    const latestUserMessage = [...input.recentMessages].reverse().find((message) => message.role === "user");
    const latestAssistantMessage = [...input.recentMessages].reverse().find((message) => message.role === "assistant");
    const progressLine = latestUserMessage && latestAssistantMessage
      ? "当前对话围绕既定目标继续推进，最近一轮已经形成新的阶段性回应。"
      : latestUserMessage
        ? "当前对话刚接收新的补充输入，正在据此调整处理方向。"
        : "当前对话刚形成新的阶段性回应，后续应继续推进收敛。";
    const statusLine = latestUserMessage && latestAssistantMessage
      ? "当前状态: 已完成一轮新的输入与回应，主线任务保持连续。"
      : latestUserMessage
        ? "当前状态: 已收到新的输入，待进一步分析与回应。"
        : "当前状态: 对话保持进行中。";
    const nextActionLine = latestAssistantMessage
      ? "后续动作: 依据当前阶段性回应，继续推进并收敛下一步结论。"
      : "后续动作: 优先消化最新输入，并继续推进当前 Conversation 目标。";

    return [
      "## 会话概览",
      previousOverview || `当前对话围绕“${input.conversation.title}”推进，需结合最新消息继续完成当前 Conversation 目标。`,
      "",
      "## 当前进展",
      progressLine,
      statusLine,
      nextActionLine,
    ].join("\n");
  }
}

class MockMentionExtractor implements MentionExtractor {
  async extractMentions(input: MentionExtractionInput): Promise<MentionExtractionResult> {
    const mentions = input.participatingSnails
      .filter((snail) => input.messageText.includes(`@${snail.name}`))
      .map((snail) => ({ snail: snail.name, raw: `@${snail.name}` }));
    return { mentions };
  }
}

const TEST_DB = path.join(__dirname, "..", "data", "test-integration.db");
fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });

function req(method: string, url: string, body?: any): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
    };
    const request = http.request(options, (response) => {
      let data = "";
      response.on("data", (chunk) => (data += chunk));
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode!, data: data ? JSON.parse(data) : null });
        } catch {
          resolve({ status: response.statusCode!, data });
        }
      });
    });
    request.on("error", reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

interface IntegrationContext {
  base: string;
  store: ConversationStore;
  claudeAgent: MockAgent;
  openCodeAgent: MockAgent;
  projectManager: ProjectManager;
  projectId: string;
  initialStageId: string;
  initialConversationId: string;
}

function resetAgentSnapshots(context: IntegrationContext): void {
  context.claudeAgent.lastMessages = [];
  context.claudeAgent.lastIncrementalMessages = [];
  context.openCodeAgent.lastMessages = [];
  context.openCodeAgent.lastIncrementalMessages = [];
}

async function createInitialProject(base: string): Promise<Pick<IntegrationContext, "projectId" | "initialStageId" | "initialConversationId">> {
  const created = await req("POST", `${base}/projects`, {
    name: "Snail Shell",
    summary: "Self evolution project",
    kind: "system_self",
  });
  assert(created.status === 201, "project should be created");
  return {
    projectId: created.data.project.id,
    initialStageId: created.data.stage.id,
    initialConversationId: created.data.conversation.id,
  };
}

async function verifyInitialProjectState(context: IntegrationContext): Promise<void> {
  const project = await req("GET", `${context.base}/projects/${context.projectId}`);
  assert(project.data.stage_count === 1, "project should start with one stage");

  const snails = await req("GET", `${context.base}/snails`);
  assert(Array.isArray(snails.data) && snails.data.length > 0, "snails should be available");
}

async function verifyConversationFlow(context: IntegrationContext): Promise<string> {
  const msgRes = await req("POST", `${context.base}/conversations/${context.initialConversationId}/messages`, {
    content: "hello shell",
  });
  console.log("Reply received:", msgRes.data.reply);
  console.log("Reply type:", typeof msgRes.data.reply);
  assert(typeof msgRes.data.reply === "string" && msgRes.data.reply.includes("hello shell"), "conversation should work");

  const initialConversationAfterFirstTurn = await req("GET", `${context.base}/conversations/${context.initialConversationId}`);
  assert(typeof initialConversationAfterFirstTurn.data.summary === "string", "conversation summary should be generated after a turn");
  assert(initialConversationAfterFirstTurn.data.summary.includes("## 会话概览"), "summary should use markdown headings");
  assert(initialConversationAfterFirstTurn.data.summary.includes("## 当前进展"), "summary should include progress section");
  assert(!initialConversationAfterFirstTurn.data.summary.includes("hello shell"), "summary should avoid repeating concrete message content");

  const directedMsgRes = await req("POST", `${context.base}/conversations/${context.initialConversationId}/messages`, {
    content: "@Owner Snail hello owner",
  });
  assert(directedMsgRes.status === 200, "directed message should work");
  assert(directedMsgRes.data.reply === "Owner Snail first reply", "directed reply should use targeted snail");

  const invalidDirectedMsgRes = await req("POST", `${context.base}/conversations/${context.initialConversationId}/messages`, {
    content: "@Unknown Snail hello",
  });
  assert(invalidDirectedMsgRes.status === 200, "unknown snail should fall back to default snail");

  const collaborationRes = await req("POST", `${context.base}/conversations/${context.initialConversationId}/messages`, {
    content: "handoff please",
  });
  assert(collaborationRes.status === 200, "collaboration chain should complete");
  assert(collaborationRes.data.reply === "Owner Snail final summary without further handoff", "forced wrap-up should end with default snail");

  const summarizedConversation = await req("POST", `${context.base}/stages/${context.initialStageId}/conversations`, {
    project_id: context.projectId,
    title: "Summary context conversation",
    kind: "planning",
    summary: "此前讨论确认默认上下文只注入摘要和最近五条消息。",
  });
  assert(summarizedConversation.status === 201, "summary conversation should be created");
  return summarizedConversation.data.id;
}

async function verifyConversationHistoryAndTools(context: IntegrationContext, summarizedConversationId: string): Promise<void> {
  for (let i = 1; i <= 7; i += 1) {
    const response = await req("POST", `${context.base}/conversations/${summarizedConversationId}/messages`, {
      content: `history turn ${i}`,
    });
    assert(response.status === 200, `history turn ${i} should succeed`);
  }

  const recentRes = await req("GET", `${context.base}/conversations/${summarizedConversationId}/messages/recent?limit=3`);
  assert(recentRes.status === 200, "recent messages endpoint should work");
  const recentContents = recentRes.data.map((message: any) => message.parts.map((part: any) => part.text_value || part.ref_value || "").join("\n"));
  assert(recentContents.some((content: string) => content.includes("history turn 7")), "recent messages should include the latest user turn");
  assert(recentContents.some((content: string) => content.includes("history turn 5")), "recent messages should include the third-latest user turn");
  assert(!recentContents.some((content: string) => content.includes("history turn 4")), "recent messages should exclude turns before the third-latest user turn");

  const searchRes = await req("GET", `${context.base}/conversations/${summarizedConversationId}/history/search?query=history%20turn%203&limit=5`);
  assert(searchRes.status === 200, "history search should work");
  assert(searchRes.data.items.length >= 1, "history search should return matches");

  const matchedMessageId = searchRes.data.items[0].message_id;
  const byIdsRes = await req("POST", `${context.base}/conversations/${summarizedConversationId}/messages/by-ids`, {
    message_ids: [matchedMessageId],
  });
  assert(byIdsRes.status === 200, "by-ids endpoint should work");
  assert(byIdsRes.data.length === 1, "by-ids should return one message");

  const windowRes = await req("GET", `${context.base}/conversations/${summarizedConversationId}/messages/window?anchor_message_id=${matchedMessageId}&before=1&after=1`);
  assert(windowRes.status === 200, "window endpoint should work");
  assert(windowRes.data.items.length >= 1, "window endpoint should return surrounding messages");

  const pagedRes = await req("GET", `${context.base}/conversations/${summarizedConversationId}/messages/page?limit=3&offset=0`);
  assert(pagedRes.status === 200, "paged messages endpoint should work");
  assert(pagedRes.data.items.length === 3, "paged messages should respect limit");

  const lastAgentMessages = context.claudeAgent.lastMessages;
  assert(lastAgentMessages.some((message) => message.content.includes("Conversation summary:")), "agent input should include conversation summary");
  const nonSummaryContextMessages = lastAgentMessages.filter((message) => !message.content.startsWith("Conversation summary:\n"));
  const historyTurnsInContext = nonSummaryContextMessages.filter((message) => message.content.includes("history turn "));
  assert(historyTurnsInContext.some((message) => message.content.includes("history turn 5")), "agent input should include the recent three user turns window");
  assert(!historyTurnsInContext.some((message) => message.content.includes("history turn 4")), "agent input should exclude turns before the recent three user turns window");

  let observedToolEvent: any = null;
  const captureToolEvent = (conversationId: string, event: any) => {
    if (conversationId === summarizedConversationId && event.type === "tool_use") {
      observedToolEvent = event;
    }
  };
  context.projectManager.on("agent-event", captureToolEvent);
  context.claudeAgent.emitSyntheticToolUse = true;
  const syntheticToolRes = await req("POST", `${context.base}/conversations/${summarizedConversationId}/messages`, {
    content: "触发 synthetic tool use",
  });
  context.claudeAgent.emitSyntheticToolUse = false;
  context.projectManager.off("agent-event", captureToolEvent);
  assert(syntheticToolRes.status === 200, "synthetic tool use round should succeed");
  assert(observedToolEvent?.summary?.includes("读取文件"), "tool use event should include readable summary");
  assert(observedToolEvent?.detail?.includes("/tmp/example.md"), "tool use event should include readable detail");
  assert(context.claudeAgent.lastSystemPrompt?.includes("默认只会向你提供当前 Conversation 摘要与最近少量消息") === true, "system prompt should explain partial history policy");
  assert(context.claudeAgent.lastSystemPrompt?.includes(".meta/scripts/conversation-history") === true, "system prompt should expose the history script path");
  assert(context.claudeAgent.lastSystemPrompt?.includes(`当前 Conversation ID: ${summarizedConversationId}`) === true, "system prompt should expose current conversation id");
  assert(context.claudeAgent.lastSystemPrompt?.includes("recent 的 --limit 表示最近 N 次用户发言对应的完整对话窗口") === true, "system prompt should explain recent limit semantics");
  assert(context.claudeAgent.lastSystemPrompt?.includes("recent: USE WHEN") === true, "system prompt should document recent tool scope");
  assert(context.claudeAgent.lastSystemPrompt?.includes("search: USE WHEN") === true, "system prompt should document search tool scope");
  assert(context.claudeAgent.lastSystemPrompt?.includes("page: USE WHEN 你必须按时间顺序浏览对话") === true, "system prompt should document page tool scope");
  assert(context.claudeAgent.lastSystemPrompt?.includes("选择工具时，按问题类型匹配最合适的模式") === true, "system prompt should prefer tool-role matching over fixed workflow");

  const summarizedConversationDetail = await req("GET", `${context.base}/conversations/${summarizedConversationId}`);
  assert(summarizedConversationDetail.status === 200, "should fetch summarized conversation detail");
  assert(summarizedConversationDetail.data.summary.includes("## 当前进展"), "auto summary should include progress section");
  assert(summarizedConversationDetail.data.summary.includes("当前状态:"), "auto summary should include status line");
  assert(summarizedConversationDetail.data.summary.includes("后续动作:"), "auto summary should include next action line");
  assert(!summarizedConversationDetail.data.summary.includes("## 最近关键往返"), "auto summary should not duplicate recent message history");
  assert(!summarizedConversationDetail.data.summary.includes("history turn 7"), "auto summary should avoid concrete message text");

  const dispatchStateRes = await req("GET", `${context.base}/conversations/${context.initialConversationId}/dispatch-state`);
  assert(dispatchStateRes.status === 200, "dispatch state endpoint should work");
  assert(Array.isArray(dispatchStateRes.data.dispatches), "dispatch state should expose raw dispatches");
  assert(Array.isArray(dispatchStateRes.data.inbox_groups), "dispatch state should expose grouped inbox state");
  const productInbox = dispatchStateRes.data.inbox_groups.find((group: any) => group.target_snail === "Product Snail");
  assert(productInbox, "dispatch state should include grouped product inbox");
  assert(Array.isArray(productInbox.messages) && productInbox.messages.length > 0, "dispatch state should include message previews for each group");
}

function verifyHistoryScripts(summarizedConversationId: string): void {
  const historyScriptPath = path.join(process.cwd(), ".meta", "scripts", "conversation-history");
  const scriptSearchRaw = execFileSync(historyScriptPath, [
    "--mode", "search",
    "--db-path", TEST_DB,
    "--conversation-id", summarizedConversationId,
    "--query", "history turn 3",
    "--limit", "3",
  ], { encoding: "utf8" });
  const scriptSearch = JSON.parse(scriptSearchRaw);
  assert(Array.isArray(scriptSearch.items) && scriptSearch.items.length >= 1, "history script search should return matches");
  assert(scriptSearch.mode === "search", "history script search should expose mode");
  assert(scriptSearch.conversation_id === summarizedConversationId, "history script search should expose conversation id");

  const scriptRecentRaw = execFileSync(historyScriptPath, [
    "--mode", "recent",
    "--db-path", TEST_DB,
    "--conversation-id", summarizedConversationId,
    "--limit", "2",
  ], { encoding: "utf8" });
  const scriptRecent = JSON.parse(scriptRecentRaw);
  assert(Array.isArray(scriptRecent.items) && scriptRecent.items.length >= 2, "history script recent mode should return the requested recent user-turn window");
  assert(typeof scriptRecent.items[0].text === "string", "history script recent mode should expose compact text");
  assert(scriptRecent.items.some((item: any) => item.text.includes("history turn 7")), "history script recent mode should include the latest prior user turn in the window");
  assert(scriptRecent.items.some((item: any) => item.text.includes("触发 synthetic tool use")), "history script recent mode should include the latest user turn in the window");
  assert(!scriptRecent.items.some((item: any) => item.text.includes("history turn 6")), "history script recent mode should exclude turns before the requested user-turn window");

  const scriptReindexRaw = execFileSync(historyScriptPath, [
    "--mode", "reindex",
    "--db-path", TEST_DB,
    "--conversation-id", summarizedConversationId,
  ], { encoding: "utf8" });
  const scriptReindex = JSON.parse(scriptReindexRaw);
  assert(scriptReindex.mode === "reindex", "history script reindex should expose mode");
  assert(typeof scriptReindex.indexed_messages === "number" && scriptReindex.indexed_messages > 0, "history script reindex should report indexed messages");
}

async function verifyArtifactsAndStageAdvance(context: IntegrationContext): Promise<void> {
  const historyRes = await req("GET", `${context.base}/conversations/${context.initialConversationId}/messages`);
  assert(historyRes.data[1].producer_snail === "Owner Snail", "assistant message should store snail speaker");
  assert(historyRes.data.some((message: any) => message.producer_snail === "Product Snail"), "mention collaboration should persist Product Snail reply");

  // Debug: log all Owner Snail messages with their parts
  const ownerSnailMessages = historyRes.data.filter((message: any) => message.producer_snail === "Owner Snail");
  console.log("Owner Snail messages count:", ownerSnailMessages.length);
  ownerSnailMessages.forEach((msg: any, idx: number) => {
    console.log(`Owner Snail message ${idx}:`, JSON.stringify(msg.parts, null, 2));
    msg.parts.forEach((part: any) => {
      console.log(`  Part ${part.id} mentions:`, part.mentions);
    });
  });

  const assistantMentionMessage = historyRes.data.find((message: any) =>
    message.producer_snail === "Owner Snail" &&
    message.parts.some((part: any) => part.part_type === PartType.CONTENT && Array.isArray(part.mentions) && part.mentions.length > 0)
  );
  assert(assistantMentionMessage, "assistant mention reply should persist structured mention parts");
  const collaborationSpeakers = historyRes.data.filter((message: any) => message.producer_snail).map((message: any) => message.producer_snail);
  assert(collaborationSpeakers.filter((snail: string) => snail === "Owner Snail").length >= 2, "forced wrap-up should add another Owner Snail reply");
  assert(historyRes.data.some((message: any) => message.role === "system"), "forced wrap-up notice should persist as system message");

  const stageConversation = await req("POST", `${context.base}/stages/${context.initialStageId}/conversations`, {
    project_id: context.projectId,
    title: "Requirements discussion",
    kind: "planning",
    from_conversation_ids: [context.initialConversationId],
  });
  assert(stageConversation.status === 201, "should create second conversation");
  assert(typeof stageConversation.data.default_snail === "string", "conversation should expose default snail");

  const artifactRes = await req("POST", `${context.base}/conversations/${context.initialConversationId}/artifacts`, {
    artifact_type: "project_charter",
    title: "Project Charter",
    storage_type: "inline_text",
    inline_content: "Snail Shell self project charter",
  });
  assert(artifactRes.status === 201, "artifact should be created");
  const artifactId = artifactRes.data.id;

  const discussionArtifactRes = await req("POST", `${context.base}/conversations/${context.initialConversationId}/artifacts`, {
    artifact_type: "initiative_discussion_record",
    title: "Initiative Discussion Record",
    storage_type: "inline_text",
    inline_content: "Initial discussion notes",
  });
  assert(discussionArtifactRes.status === 201, "discussion artifact should be created");
  const discussionArtifactId = discussionArtifactRes.data.id;

  const formalRes = await req("PUT", `${context.base}/stages/${context.initialStageId}/formal-artifacts`, {
    artifact_ids: [artifactId, discussionArtifactId],
  });
  assert(formalRes.data.formal_artifacts.length === 2, "formal artifacts should be saved");

  const nextStageRes = await req("POST", `${context.base}/projects/${context.projectId}/advance`, {});
  assert(nextStageRes.status === 201, "next stage should be created");
  assert(nextStageRes.data.conversation.stage_id === nextStageRes.data.next_stage.id, "next stage conversation should be created");

  const stageList = await req("GET", `${context.base}/projects/${context.projectId}/stages`);
  assert(stageList.data.length === 2, "project should now have two stage instances");
}

async function verifyReplyToMessage(context: IntegrationContext): Promise<void> {
  const conversationId = context.initialConversationId;
  const before = await req("GET", `${context.base}/conversations/${conversationId}/messages`);
  const targetMessage = before.data.find((message: any) => message.role === "assistant");
  assert(targetMessage?.id, "should have an assistant message to reply to");

  const replyRes = await req("POST", `${context.base}/conversations/${conversationId}/messages`, {
    parts: [{ part_type: PartType.CONTENT, text_value: "这是一条带引用的回复" }],
    producer_snail: "Boss Snail",
    reply_to_message_id: targetMessage.id,
  });
  assert(replyRes.status === 200, "reply message should succeed");

  const after = await req("GET", `${context.base}/conversations/${conversationId}/messages`);
  const replyMessage = [...after.data].reverse().find((message: any) => message.role === "user" && message.reply_to_message_id === targetMessage.id);
  assert(replyMessage, "reply_to_message_id should be persisted on replied user message");
  // Quote is now stored at message level via quoted_message_id, not as a separate part
  assert(replyMessage.quoted_message_id === targetMessage.id, "reply message should have quoted_message_id");
}

async function verifyBossMentionAck(context: IntegrationContext): Promise<void> {
  const conversationRes = await req("POST", `${context.base}/stages/${context.initialStageId}/conversations`, {
    project_id: context.projectId,
    title: "Boss mention ack conversation",
    kind: "discussion",
    from_conversation_ids: [context.initialConversationId],
  });
  assert(conversationRes.status === 201, "boss mention ack conversation should be created");
  const conversationId = conversationRes.data.id;

  const bossMentionMessage = context.store.addMessage({ conversationId, producerSnail: "Owner Snail", role: "assistant" });
  context.store.replaceMessageParts(bossMentionMessage.id, [
    { part_type: PartType.CONTENT, text_value: "@老大 请看一下这里的结论", mentions: ["Boss Snail"] },
  ]);
  context.store.addMessageDispatch({ conversationId, messageId: bossMentionMessage.id, targetSnail: "Boss Snail" });

  const beforeAck = await req("GET", `${context.base}/conversations/${conversationId}/boss-mentions`);
  assert(beforeAck.status === 200, "boss mentions endpoint should work before ack");
  assert(beforeAck.data.length >= 1, "boss mentions should list pending boss mention items");

  const stageConversations = await req("GET", `${context.base}/stages/${context.initialStageId}/conversations`);
  const targetConversation = stageConversations.data.find((conversation: any) => conversation.id === conversationId);
  assert(targetConversation?.boss_pending_count >= 1, "conversation listing should expose boss pending count");

  const projectDetailBeforeAck = await req("GET", `${context.base}/projects/${context.projectId}`);
  assert(projectDetailBeforeAck.data.boss_pending_count >= 1, "project detail should expose aggregated boss pending count");
  const stageBeforeAck = projectDetailBeforeAck.data.stages.find((stage: any) => stage.id === context.initialStageId);
  assert(stageBeforeAck?.boss_pending_count >= 1, "stage detail should expose aggregated boss pending count");

  const ackRes = await req("POST", `${context.base}/conversations/${conversationId}/boss-mentions/ack`, {});
  assert(ackRes.status === 200, "boss mention ack should succeed");
  assert(ackRes.data.length >= 1, "boss mention ack should return acknowledged mention items");

  const dispatchState = await req("GET", `${context.base}/conversations/${conversationId}/dispatch-state`);
  const bossSeenGroup = dispatchState.data.inbox_groups.find((group: any) => group.target_snail === "Boss Snail" && group.status === "seen");
  assert(bossSeenGroup, "boss mention should transition to seen after ack");

  const conversationDetail = await req("GET", `${context.base}/conversations/${conversationId}`);
  assert(conversationDetail.data.boss_pending_count === 0, "conversation detail should show cleared boss pending count after ack");
  const projectDetailAfterAck = await req("GET", `${context.base}/projects/${context.projectId}`);
  const stageAfterAck = projectDetailAfterAck.data.stages.find((stage: any) => stage.id === context.initialStageId);
  assert(projectDetailAfterAck.data.boss_pending_count === 0, "project detail should clear aggregated boss pending count after ack");
  assert(stageAfterAck?.boss_pending_count === 0, "stage detail should clear aggregated boss pending count after ack");
}

async function verifyRuntimeSwitching(context: IntegrationContext): Promise<void> {
  const stagesRes = await req("GET", `${context.base}/projects/${context.projectId}/stages`);
  const discussStage = stagesRes.data.find((stage: any) => stage.type === "discuss" && stage.status === "in_progress");
  assert(discussStage, "discuss stage should be active before advancing");

  const discussConversationsRes = await req("GET", `${context.base}/stages/${discussStage.id}/conversations`);
  const discussConversation = discussConversationsRes.data[0];
  assert(discussConversation, "active discuss stage should have a conversation");

  const requirementArtifactRes = await req("POST", `${context.base}/conversations/${discussConversation.id}/artifacts`, {
    artifact_type: "requirement_document",
    title: "Requirement Document",
    storage_type: "inline_text",
    inline_content: "Coding stage input",
  });
  assert(requirementArtifactRes.status === 201, "requirement artifact should be created");

  const discussFormalRes = await req("PUT", `${context.base}/stages/${discussConversation.stage_id}/formal-artifacts`, {
    artifact_ids: [requirementArtifactRes.data.id],
  });
  assert(discussFormalRes.status === 200, "discussion formal artifacts should be saved");

  const codingStageRes = await req("POST", `${context.base}/projects/${context.projectId}/advance`, {});
  assert(codingStageRes.status === 201, "coding stage should be created");
  const codingConversationId = codingStageRes.data.conversation.id;

  const codeChangeRecordRes = await req("POST", `${context.base}/conversations/${codingConversationId}/artifacts`, {
    artifact_type: "code_change_record",
    title: "Code Change Record",
    storage_type: "inline_text",
    inline_content: "Implemented the requested change",
  });
  assert(codeChangeRecordRes.status === 201, "code change record should be created");

  const codingFormalRes = await req("PUT", `${context.base}/stages/${codingStageRes.data.next_stage.id}/formal-artifacts`, {
    artifact_ids: [codeChangeRecordRes.data.id],
  });
  assert(codingFormalRes.status === 200, "coding formal artifacts should be saved");

  const checkStageRes = await req("POST", `${context.base}/projects/${context.projectId}/advance`, {});
  assert(checkStageRes.status === 201, "check stage should be created");
  const checkConversationId = checkStageRes.data.conversation.id;

  const claudeBefore = context.claudeAgent.invocationCount;
  const openCodeBefore = context.openCodeAgent.invocationCount;

  const response = await req("POST", `${context.base}/conversations/${checkConversationId}/messages`, {
    content: "请处理这个验收问题",
  });

  assert(response.status === 200, "runtime switching round should succeed");
  assert(context.openCodeAgent.invocationCount > openCodeBefore, "acceptance snail should use opencode runtime in check stage");
  assert(context.claudeAgent.invocationCount === claudeBefore, "check conversation default snail should not route through claude runtime");

  const conversation = await req("GET", `${context.base}/conversations/${checkConversationId}`);
  assert(conversation.data.runtime_sessions["Acceptance Snail"]?.sessionId === "ses_mock", "acceptance snail should persist its own runtime session binding");
  assert(!conversation.data.runtime_sessions["Owner Snail"], "other snails should not implicitly share the acceptance session binding");
}

async function verifyStatefulIncrementalContext(context: IntegrationContext): Promise<void> {
  const stagesRes = await req("GET", `${context.base}/projects/${context.projectId}/stages`);
  const checkStage = stagesRes.data.find((stage: any) => stage.type === "check" && stage.status === "in_progress");
  assert(checkStage, "check stage should exist before creating follow-up acceptance conversation");

  const conversationRes = await req("POST", `${context.base}/stages/${checkStage.id}/conversations`, {
    project_id: context.projectId,
    title: "Acceptance follow-up",
    kind: "review",
    from_conversation_ids: [context.initialConversationId],
  });
  assert(conversationRes.status === 201, "should create follow-up conversation");
  const conversationId = conversationRes.data.id;

  resetAgentSnapshots(context);
  const firstRound = await req("POST", `${context.base}/conversations/${conversationId}/messages`, {
    content: "请 @Acceptance Snail 先确认第一版结果",
  });
  assert(firstRound.status === 200, "first acceptance round should succeed");

  const secondRound = await req("POST", `${context.base}/conversations/${conversationId}/messages`, {
    content: "我补充了一点信息，请继续处理",
  });
  assert(secondRound.status === 200, "second acceptance round should succeed");

  const incrementalMessages = context.openCodeAgent.lastIncrementalMessages.map((message) => message.content);
  assert(incrementalMessages.some((content) => content.includes("我补充了一点信息，请继续处理")), "stateful runtime should include the latest user turn in incremental context");
  assert(incrementalMessages.some((content) => content.includes("Owner Snail:") || content.includes("USER:")), "stateful runtime should include the full message sequence since the last acceptance reply");
}

// 测试 mention 解析和结构化存储
async function verifyMentionParsing(context: IntegrationContext): Promise<void> {
  const conversationRes = await req("POST", `${context.base}/stages/${context.initialStageId}/conversations`, {
    project_id: context.projectId,
    title: "Mention parsing test",
    kind: "discussion",
    from_conversation_ids: [],
  });
  assert(conversationRes.status === 201, "mention parsing conversation should be created");
  const conversationId = conversationRes.data.id;

  // 直接创建包含 mention parts 的消息
  const message = context.store.addMessage({ conversationId, producerSnail: "Boss Snail", role: "user" });
  context.store.replaceMessageParts(message.id, [
    { part_type: PartType.CONTENT, text_value: "请 @Product Snail 分析需求，然后 @Design Snail 设计方案", mentions: ["Product Snail", "Design Snail"] },
  ]);

  // 验证消息 parts 结构
  const messages = context.store.getMessages(conversationId);
  const userMessage = messages.find((msg) => msg.id === message.id);
  if (!userMessage) {
    throw new Error("user message should exist");
  }

  const contentPart = userMessage.parts.find((part) => part.part_type === PartType.CONTENT);
  assert(contentPart, "should have content part");
  assert(contentPart?.mentions?.length === 2, "should have two mentions");
  assert(contentPart?.mentions?.includes("Product Snail"), "should mention Product Snail");
  assert(contentPart?.mentions?.includes("Design Snail"), "should mention Design Snail");
}

// 测试 dispatch 入队和消费
async function verifyDispatchQueueing(context: IntegrationContext): Promise<void> {
  const conversationRes = await req("POST", `${context.base}/stages/${context.initialStageId}/conversations`, {
    project_id: context.projectId,
    title: "Dispatch queueing test",
    kind: "discussion",
    from_conversation_ids: [],
  });
  assert(conversationRes.status === 201, "dispatch queueing conversation should be created");
  const conversationId = conversationRes.data.id;

  // 手动创建消息和 dispatch
  const message = context.store.addMessage({ conversationId, producerSnail: "Boss Snail", role: "user" });
  context.store.replaceMessageParts(message.id, [
    { part_type: PartType.CONTENT, text_value: "@Product Snail 请处理", mentions: ["Product Snail"] },
  ]);
  context.store.addMessageDispatch({ conversationId, messageId: message.id, targetSnail: "Product Snail" });

  // 验证 pending dispatch
  const pendingDispatches = context.store.listPendingDispatches(conversationId);
  assert(pendingDispatches.length === 1, "should have one pending dispatch");
  assert(pendingDispatches[0].target_snail === "Product Snail", "dispatch target should be product_agent");
  assert(pendingDispatches[0].status === "pending", "dispatch status should be pending");

  // 模拟消费 dispatch
  const replyMessage = context.store.addMessage({ conversationId, producerSnail: "Product Snail", role: "assistant" });
  context.store.replaceMessageParts(replyMessage.id, [{ part_type: PartType.CONTENT, text_value: "已处理" }]);
  context.store.markDispatchesConsumed([pendingDispatches[0].id], replyMessage.id);

  // 验证 consumed dispatch
  const allDispatches = context.store.listDispatches(conversationId);
  const consumedDispatch = allDispatches.find((d) => d.id === pendingDispatches[0].id);
  assert(consumedDispatch?.status === "consumed", "dispatch should be marked as consumed");
  assert(consumedDispatch?.consumed_by_message_id === replyMessage.id, "dispatch should reference consuming message");
}

// 测试协作轮数限制
async function verifyCollaborationTurnLimit(context: IntegrationContext): Promise<void> {
  const conversationRes = await req("POST", `${context.base}/stages/${context.initialStageId}/conversations`, {
    project_id: context.projectId,
    title: "Collaboration turn limit test",
    kind: "discussion",
    from_conversation_ids: [],
  });
  assert(conversationRes.status === 201, "collaboration turn limit conversation should be created");
  const conversationId = conversationRes.data.id;

  // 模拟达到轮数上限的场景：创建多轮 dispatch
  const msg1 = context.store.addMessage({ conversationId, producerSnail: "Boss Snail", role: "user" });
  context.store.replaceMessageParts(msg1.id, [
    { part_type: PartType.CONTENT, text_value: "@Product Snail", mentions: ["Product Snail"] },
  ]);
  const dispatch1 = context.store.addMessageDispatch({ conversationId, messageId: msg1.id, targetSnail: "Product Snail" });

  const msg2 = context.store.addMessage({ conversationId, producerSnail: "Product Snail", role: "assistant" });
  context.store.replaceMessageParts(msg2.id, [
    { part_type: PartType.CONTENT, text_value: "回复1 @Design Snail", mentions: ["Design Snail"] },
  ]);
  context.store.markDispatchesConsumed([dispatch1.id], msg2.id);
  const dispatch2 = context.store.addMessageDispatch({ conversationId, messageId: msg2.id, targetSnail: "Design Snail" });

  const msg3 = context.store.addMessage({ conversationId, producerSnail: "Design Snail", role: "assistant" });
  context.store.replaceMessageParts(msg3.id, [
    { part_type: PartType.CONTENT, text_value: "回复2 @Implementation Snail", mentions: ["Implementation Snail"] },
  ]);
  context.store.markDispatchesConsumed([dispatch2.id], msg3.id);
  const dispatch3 = context.store.addMessageDispatch({ conversationId, messageId: msg3.id, targetSnail: "Implementation Snail" });

  // 验证有 3 个 dispatch（达到 MAX_COLLABORATION_TURNS）
  const allDispatches = context.store.listDispatches(conversationId);
  assert(allDispatches.length === 3, "should have 3 dispatches");

  // 验证最后一个 dispatch 的状态
  const lastDispatch = allDispatches.find((d) => d.id === dispatch3.id);
  assert(lastDispatch?.status === "pending", "last dispatch should be pending");
  assert(lastDispatch?.target_snail === "Implementation Snail", "last dispatch should target implementation_agent");
}

// 测试使用消息 ID 作为 context cutoff
async function verifyContextCutoffWithMessageId(context: IntegrationContext): Promise<void> {
  const conversationRes = await req("POST", `${context.base}/stages/${context.initialStageId}/conversations`, {
    project_id: context.projectId,
    title: "Context cutoff test",
    kind: "discussion",
    from_conversation_ids: [],
  });
  assert(conversationRes.status === 201, "context cutoff conversation should be created");
  const conversationId = conversationRes.data.id;

  // 创建多条消息
  const msg1 = context.store.addMessage({ conversationId, producerSnail: "Boss Snail", role: "user" });
  context.store.replaceMessageParts(msg1.id, [{ part_type: PartType.CONTENT, text_value: "消息1" }]);

  const msg2 = context.store.addMessage({ conversationId, producerSnail: "Product Snail", role: "assistant" });
  context.store.replaceMessageParts(msg2.id, [{ part_type: PartType.CONTENT, text_value: "回复1" }]);

  const msg3 = context.store.addMessage({ conversationId, producerSnail: "Boss Snail", role: "user" });
  context.store.replaceMessageParts(msg3.id, [{ part_type: PartType.CONTENT, text_value: "消息2" }]);

  // 验证消息 ID 是递增的
  assert(msg1.id < msg2.id, "message IDs should be incrementing");
  assert(msg2.id < msg3.id, "message IDs should be incrementing");

  // 验证可以通过 ID 过滤历史
  const allMessages = context.store.getMessages(conversationId);
  const filteredMessages = allMessages.filter((msg) => msg.id <= msg2.id);
  assert(filteredMessages.length === 2, "should filter messages by ID correctly");
  assert(filteredMessages.some((m) => m.id === msg1.id), "should include msg1");
  assert(filteredMessages.some((m) => m.id === msg2.id), "should include msg2");
  assert(!filteredMessages.some((m) => m.id === msg3.id), "should not include msg3");
}

async function verifyBossSnailForcedWrapUp(context: IntegrationContext): Promise<void> {
  resetAgentSnapshots(context);

  const conv = await req("POST", `${context.base}/stages/${context.initialStageId}/conversations`, {
    project_id: context.projectId,
    title: "Boss Snail forced wrap-up test",
    kind: "planning",
  });
  const convId = conv.data.id;

  // Track which snails are invoked and in what mode
  const invocations: Array<{ snail: string; forcedWrapUp: boolean }> = [];

  // Configure custom reply to create a ping-pong between Owner and Product that exceeds MAX_COLLABORATION_TURNS (3)
  // Turn 1: Owner -> Product (remainingTurns=3)
  // Turn 2: Product -> Owner (remainingTurns=2)
  // Turn 3: Owner -> Product (remainingTurns=1)
  // Turn 4: Product (remainingTurns=0, forcedWrapUp=true, should NOT create new dispatches)
  context.claudeAgent.setCustomReply((ctx) => {
    invocations.push({ snail: ctx.currentSnail, forcedWrapUp: ctx.forcedWrapUp });

    // Any snail in forcedWrapUp mode tries to delegate (this should NOT create dispatches)
    if (ctx.forcedWrapUp) {
      return {
        content: JSON.stringify({ content: `${ctx.currentSnail} trying to delegate to @Product Snail`, mentions: ["Product Snail"] }),
      };
    }

    // Create a ping-pong: Owner <-> Product
    if (ctx.currentSnail === "Owner Snail") {
      return {
        content: JSON.stringify({ content: "Owner Snail delegating to @Product Snail", mentions: ["Product Snail"] }),
      };
    }

    if (ctx.currentSnail === "Product Snail") {
      return {
        content: JSON.stringify({ content: "Product Snail delegating back to @Owner Snail", mentions: ["Owner Snail"] }),
      };
    }

    return { content: `${ctx.currentSnail} response` };
  });

  // Set the same custom reply on openCodeAgent since Product Snail uses it
  context.openCodeAgent.setCustomReply((ctx) => {
    invocations.push({ snail: ctx.currentSnail, forcedWrapUp: ctx.forcedWrapUp });

    // Any snail in forcedWrapUp mode tries to delegate (this should NOT create dispatches)
    if (ctx.forcedWrapUp) {
      return {
        content: JSON.stringify({ content: `${ctx.currentSnail} trying to delegate to @Product Snail`, mentions: ["Product Snail"] }),
      };
    }

    // Create a ping-pong: Owner <-> Product
    if (ctx.currentSnail === "Owner Snail") {
      return {
        content: JSON.stringify({ content: "Owner Snail delegating to @Product Snail", mentions: ["Product Snail"] }),
      };
    }

    if (ctx.currentSnail === "Product Snail") {
      return {
        content: JSON.stringify({ content: "Product Snail delegating back to @Owner Snail", mentions: ["Owner Snail"] }),
      };
    }

    return { content: `${ctx.currentSnail} response` };
  });

  // Send a message to start the collaboration chain
  const msgRes = await req("POST", `${context.base}/conversations/${convId}/messages`, {
    content: "start collaboration",
  });

  assert(msgRes.status === 200, "message should succeed");
  assert(typeof msgRes.data.reply === "string", "should return a reply");

  // Debug: check all messages and dispatches
  const allMessages = context.store.getRecentMessages(convId, 100);
  console.log("All messages:", allMessages.map(m => `${m.id}: ${m.role} (${m.producer_snail || 'user'})`).join(", "));

  const allDispatches = context.store.listDispatches(convId);
  console.log("All dispatches:", allDispatches.map((d: any) => `${d.id}: msg=${d.message_id} -> ${d.target_snail} (${d.status})`).join(", "));

  // Debug: check conversation details
  const conversation = context.store.getConversation(convId);
  console.log("Participating snails:", conversation?.participating_snails.join(", "));

  // Debug: log invocations
  console.log("Invocations:", invocations.map(inv => `${inv.snail} (forcedWrapUp: ${inv.forcedWrapUp})`).join(", "));

  // Verify that at least one snail was invoked in forcedWrapUp mode
  const forcedWrapUpInvocations = invocations.filter(inv => inv.forcedWrapUp);
  assert(forcedWrapUpInvocations.length > 0, "at least one snail should be invoked in forcedWrapUp mode");

  // The key test: verify that no pending dispatches remain after forcedWrapUp
  // Even though the forcedWrapUp snail returned mention parts, they should not create dispatches
  const pendingDispatches = context.store.listPendingDispatches(convId);
  assert(pendingDispatches.length === 0, "no pending dispatches should remain after forcedWrapUp");

  // Reset custom reply to default behavior for subsequent tests
  context.claudeAgent.customReplyFn = undefined;
  context.openCodeAgent.customReplyFn = undefined;
}

async function verifyAskUserRoutingEdgeCases(context: IntegrationContext): Promise<void> {
  // Test 1: Cross-conversation reply_to_message_id should not affect routing
  const conv1Res = await req("POST", `${context.base}/stages/${context.initialStageId}/conversations`, {
    project_id: context.projectId,
    title: "Conversation 1 for edge case test",
    kind: "discussion",
  });
  assert(conv1Res.status === 201, "conversation 1 should be created");
  const conv1Id = conv1Res.data.id;

  const conv2Res = await req("POST", `${context.base}/stages/${context.initialStageId}/conversations`, {
    project_id: context.projectId,
    title: "Conversation 2 for edge case test",
    kind: "discussion",
  });
  assert(conv2Res.status === 201, "conversation 2 should be created");
  const conv2Id = conv2Res.data.id;

  // Create a message from Product Snail in conversation 1
  const conv1Message = context.store.addMessage({ conversationId: conv1Id, producerSnail: "Product Snail", role: "assistant" });
  context.store.replaceMessageParts(conv1Message.id, [
    { part_type: "text", text_value: "Product Snail message in conv1" },
  ]);

  // Try to reply to conv1's message from conv2 (cross-conversation)
  // This should NOT route to Product Snail because getMessage should enforce conversation isolation
  const crossConvReplyRes = await req("POST", `${context.base}/conversations/${conv2Id}/messages`, {
    parts: [{ part_type: "text", text_value: "User reply from conv2" }],
    producer_snail: "Boss Snail",
    reply_to_message_id: conv1Message.id,
  });
  assert(crossConvReplyRes.status === 200, "cross-conversation reply should succeed");

  // Verify that the message was routed to default_snail (Boss Snail), not Product Snail
  const conv2Dispatches = context.store.listDispatches(conv2Id);
  const productSnailDispatches = conv2Dispatches.filter((d: any) => d.target_snail === "Product Snail");
  assert(productSnailDispatches.length === 0, "cross-conversation reply should NOT route to Product Snail");

  // Test 2: Reply to user message should not use that message's producer as fallback
  const userMessage = context.store.addMessage({ conversationId: conv2Id, producerSnail: null, role: "user" });
  context.store.replaceMessageParts(userMessage.id, [
    { part_type: "text", text_value: "User message" },
  ]);

  const replyToUserRes = await req("POST", `${context.base}/conversations/${conv2Id}/messages`, {
    parts: [{ part_type: "text", text_value: "Reply to user message" }],
    producer_snail: "Boss Snail",
    reply_to_message_id: userMessage.id,
  });
  assert(replyToUserRes.status === 200, "reply to user message should succeed");

  // Test 3: Explicit mention should take precedence over reply-to fallback
  const ownerMessage = context.store.addMessage({ conversationId: conv2Id, producerSnail: "Owner Snail", role: "assistant" });
  context.store.replaceMessageParts(ownerMessage.id, [
    { part_type: "text", text_value: "Owner Snail message" },
  ]);

  // Check dispatches before sending the explicit mention message
  const dispatchesBeforeExplicitMention = context.store.listDispatches(conv2Id);
  const dispatchCountBefore = dispatchesBeforeExplicitMention.length;

  const explicitMentionRes = await req("POST", `${context.base}/conversations/${conv2Id}/messages`, {
    parts: [
      { part_type: "mention", text_value: "@Product Snail", ref_value: "Product Snail" },
      { part_type: "text", text_value: " explicit mention" },
    ],
    producer_snail: "Boss Snail",
    reply_to_message_id: ownerMessage.id,
  });
  assert(explicitMentionRes.status === 200, "explicit mention with reply_to should succeed");

  // Verify that Product Snail was dispatched (explicit mention), not Owner Snail (reply-to fallback)
  const finalDispatches = context.store.listDispatches(conv2Id);

  // Get only the new dispatches created by the explicit mention message
  const newDispatches = finalDispatches.slice(dispatchCountBefore);
  const newProductDispatches = newDispatches.filter((d: any) => d.target_snail === "Product Snail");
  const newOwnerDispatches = newDispatches.filter((d: any) => d.target_snail === "Owner Snail");

  assert(newProductDispatches.length > 0, "explicit mention should dispatch to Product Snail");
  // Owner Snail should NOT receive a dispatch because explicit mention takes precedence
  assert(newOwnerDispatches.length === 0, "reply-to fallback should NOT apply when explicit mention exists");
}


async function main() {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

  const store = new ConversationStore(TEST_DB);
  const claudeAgent = new MockAgent("claude-code-cli");
  const openCodeAgent = new MockAgent("opencode-cli");
  const agentResolver = new RuntimeSnailAgentResolver([claudeAgent, openCodeAgent]);
  const snailRegistry = new SnailRegistry();
  const summaryGenerator = new MockSummaryGenerator();
  const mentionExtractor = new MockMentionExtractor();
  const projectManager = new ProjectManager(store, agentResolver, snailRegistry, summaryGenerator, mentionExtractor);
  const { server } = createServer(projectManager);

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as any).port;
      const base = `http://localhost:${port}/api`;

      (async () => {
        try {
          const initialProject = await createInitialProject(base);
          const context: IntegrationContext = {
            base,
            store,
            claudeAgent,
            openCodeAgent,
            projectManager,
            ...initialProject,
          };
          await verifyInitialProjectState(context);
          const summarizedConversationId = await verifyConversationFlow(context);
          await verifyConversationHistoryAndTools(context, summarizedConversationId);
          verifyHistoryScripts(summarizedConversationId);
          await verifyArtifactsAndStageAdvance(context);
          await verifyReplyToMessage(context);
          await verifyBossMentionAck(context);
          await verifyBossSnailForcedWrapUp(context);
          await verifyRuntimeSwitching(context);
          await verifyStatefulIncrementalContext(context);
          await verifyMentionParsing(context);
          await verifyDispatchQueueing(context);
          await verifyCollaborationTurnLimit(context);
          await verifyContextCutoffWithMessageId(context);
          await verifyAskUserRoutingEdgeCases(context);

          console.log("\n✅ All integration tests passed!");
        } catch (err) {
          process.stderr.write(`Test error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
          process.exitCode = 1;
        } finally {
          server.close();
          store.close();
          if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
          resolve();
        }
      })();
    });
  });
}

main();
