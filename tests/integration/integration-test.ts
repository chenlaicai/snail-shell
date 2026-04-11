import fs from "fs";
import http from "http";
import path from "path";
import { execFileSync } from "child_process";
import type { Agent, AgentEvent, AgentMessage, AgentReply } from "../../src/agent/interface";
import { createServer } from "../../src/api/server";
import type { ConversationSummaryGenerator, ConversationSummaryInput } from "../../src/llm";
import { ConversationStore } from "../../src/persistence/store";
import { ProjectManager } from "../../src/project/manager";
import { SnailRegistry } from "../../src/snails";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

class MockAgent implements Agent {
  readonly name = "mock";
  lastMessages: AgentMessage[] = [];
  lastSystemPrompt?: string;
  emitSyntheticToolUse = false;

  async chat(messages: AgentMessage[], systemPrompt?: string): Promise<AgentReply> {
    this.lastMessages = messages;
    this.lastSystemPrompt = systemPrompt;
    const lastUserMsg = [...messages].reverse().find((message) => message.role === "user");
    const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
    const currentSnail = systemPrompt?.match(/当前响应 Snail: (.+)/)?.[1]?.trim() ?? "Owner Snail";
    const forcedWrapUp = systemPrompt?.includes("当前处于最终收口阶段") ?? false;

    if (forcedWrapUp) {
      return { content: `${currentSnail} final summary without further handoff` };
    }

    if (lastUserMsg?.content.includes("@Owner Snail hello owner")) {
      return { content: `Owner Snail first reply` };
    }

    if (lastUserMsg?.content.includes("handoff please")) {
      return { content: `@Product Snail please continue from here` };
    }

    if (latestAssistant?.content.includes("@Product Snail please continue from here")) {
      return { content: `@Owner Snail continue the collaboration` };
    }

    if (latestAssistant?.content.includes("@Owner Snail continue the collaboration")) {
      return { content: `@Product Snail wrap this up` };
    }

    return { content: `echo: ${lastUserMsg?.content ?? "hello"}` };
  }

  async chatStream(messages: AgentMessage[], onEvent: (event: AgentEvent) => void, systemPrompt?: string): Promise<AgentReply> {
    this.lastMessages = messages;
    this.lastSystemPrompt = systemPrompt;

    if (this.emitSyntheticToolUse) {
      onEvent({ type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "/tmp/example.md" } });
      onEvent({ type: "result", content: "tool-backed reply" });
      return { content: "tool-backed reply" };
    }

    const reply = await this.chat(messages, systemPrompt);
    onEvent({ type: "result", content: reply.content });
    return reply;
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

const TEST_DB = path.join(__dirname, "..", "data", "test-integration.db");

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
  agent: MockAgent;
  projectManager: ProjectManager;
  projectId: string;
  initialStageId: string;
  initialConversationId: string;
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
  assert(msgRes.data.reply === "echo: USER:\nhello shell", "conversation should work");

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
  const recentContents = recentRes.data.map((message: any) => message.parts.map((part: any) => part.content).join("\n"));
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

  const lastAgentMessages = context.agent.lastMessages;
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
  context.agent.emitSyntheticToolUse = true;
  const syntheticToolRes = await req("POST", `${context.base}/conversations/${summarizedConversationId}/messages`, {
    content: "触发 synthetic tool use",
  });
  context.agent.emitSyntheticToolUse = false;
  context.projectManager.off("agent-event", captureToolEvent);
  assert(syntheticToolRes.status === 200, "synthetic tool use round should succeed");
  assert(observedToolEvent?.summary?.includes("读取文件"), "tool use event should include readable summary");
  assert(observedToolEvent?.detail?.includes("/tmp/example.md"), "tool use event should include readable detail");
  assert(context.agent.lastSystemPrompt?.includes("默认只会向你提供当前 Conversation 摘要与最近少量消息") === true, "system prompt should explain partial history policy");
  assert(context.agent.lastSystemPrompt?.includes(".meta/scripts/conversation-history") === true, "system prompt should expose the history script path");
  assert(context.agent.lastSystemPrompt?.includes(`当前 Conversation ID: ${summarizedConversationId}`) === true, "system prompt should expose current conversation id");
  assert(context.agent.lastSystemPrompt?.includes("recent 的 --limit 表示最近 N 次用户发言对应的完整对话窗口") === true, "system prompt should explain recent limit semantics");
  assert(context.agent.lastSystemPrompt?.includes("recent: USE WHEN") === true, "system prompt should document recent tool scope");
  assert(context.agent.lastSystemPrompt?.includes("search: USE WHEN") === true, "system prompt should document search tool scope");
  assert(context.agent.lastSystemPrompt?.includes("page: USE WHEN 你必须按时间顺序浏览对话") === true, "system prompt should document page tool scope");
  assert(context.agent.lastSystemPrompt?.includes("选择工具时，按问题类型匹配最合适的模式") === true, "system prompt should prefer tool-role matching over fixed workflow");

  const summarizedConversationDetail = await req("GET", `${context.base}/conversations/${summarizedConversationId}`);
  assert(summarizedConversationDetail.status === 200, "should fetch summarized conversation detail");
  assert(summarizedConversationDetail.data.summary.includes("## 当前进展"), "auto summary should include progress section");
  assert(summarizedConversationDetail.data.summary.includes("当前状态:"), "auto summary should include status line");
  assert(summarizedConversationDetail.data.summary.includes("后续动作:"), "auto summary should include next action line");
  assert(!summarizedConversationDetail.data.summary.includes("## 最近关键往返"), "auto summary should not duplicate recent message history");
  assert(!summarizedConversationDetail.data.summary.includes("history turn 7"), "auto summary should avoid concrete message text");
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
  assert(historyRes.data[1].snail_name === "Owner Snail", "assistant message should store snail speaker");
  assert(historyRes.data.some((message: any) => message.snail_name === "Product Snail"), "handoff should persist Product Snail reply");
  const collaborationSpeakers = historyRes.data.filter((message: any) => message.snail_name).map((message: any) => message.snail_name);
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

async function main() {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

  const store = new ConversationStore(TEST_DB);
  const agent = new MockAgent();
  const snailRegistry = new SnailRegistry();
  const summaryGenerator = new MockSummaryGenerator();
  const projectManager = new ProjectManager(store, agent, snailRegistry, summaryGenerator);
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
            agent,
            projectManager,
            ...initialProject,
          };
          await verifyInitialProjectState(context);
          const summarizedConversationId = await verifyConversationFlow(context);
          await verifyConversationHistoryAndTools(context, summarizedConversationId);
          verifyHistoryScripts(summarizedConversationId);
          await verifyArtifactsAndStageAdvance(context);

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
