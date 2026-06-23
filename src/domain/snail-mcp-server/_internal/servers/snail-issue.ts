import type { MCPServerConfig, MCPTool } from "@domain/snail-mcp-server/model";
import type { MessagePort } from "@domain/message/port";
import type { StagePort } from "@domain/issue/port";
import type { IssuePort } from "@domain/issue/port";

export interface ConversationContextResult {
  conv: Record<string, unknown>;
  stage: Record<string, unknown> | null;
  stageDef: Record<string, unknown> | null;
  stageRoles: Record<string, unknown>[];
  issue: Record<string, unknown> | null;
  workspace: Record<string, unknown> | null;
  inputArtifacts: Record<string, unknown>;
}

export interface HistoryMessage {
  id: number;
  conversation_id: string;
  role: string;
  from_role: string | null;
  content: string;
  created_at: string;
}

export interface EvolutionCandidateResult {
  ok: boolean;
  evolution_item_id: string;
  issue_id: string;
  conversation_id: string;
}

export interface FeatureChainResult {
  mode: string;
  items?: unknown[];
  entry?: unknown;
  chain?: unknown;
}

export interface IssueServerDeps {
  message: MessagePort;
  stage: StagePort;
  issue: IssuePort;
  updateEvolution: (id: string, updates: { status?: string; result?: string }) => Promise<{ id: string; status: string }>;
  queryConversationContext: (conversationId: string) => ConversationContextResult;
  queryConversationHistory: (params: { mode: string; issueId?: string; conversationId?: string; query?: string; limit?: number; offset?: number; anchorMessageId?: number; before?: number; after?: number; messageIds?: string[] }) => unknown;
  createEvolutionCandidate: (params: { workspaceId: string; title: string; content: string; tags?: string[]; metadata?: unknown }) => Promise<EvolutionCandidateResult>;
  searchFeatureChain: (params: { mode: string; query?: string; id?: string; direction?: string; limit?: number }) => FeatureChainResult;
}

export function createIssueServer(deps: IssueServerDeps): MCPServerConfig {
  return {
    name: "snail-issue",
    version: "1.0.0",
    tools: [
      createSetFinalBodyTool(deps),
      createRecordRepoContextTool(deps),
      createSetTaskAnchorTool(deps),
      createQueryCurrentContextTool(deps),
      createConversationHistoryTool(deps),
      createEvolutionCandidateTool(deps),
      createCompleteEvolutionItemTool(deps),
      createSearchFeatureChainTool(deps),
    ],
  };
}

function createSetFinalBodyTool(deps: IssueServerDeps): MCPTool {
  return {
    name: "set_final_body",
    description:
      "提交本次发言的最终答复正文。每次发言结束前必须调用此工具。" +
      "支持两种模式：传入 text（纯 Markdown）或 blocks（结构化 JSON 数组）。" +
      "调用后，此内容将作为消息的主要展示内容。",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "最终答复的 Markdown 正文（与 blocks 二选一）" },
        blocks: { type: "array", description: "结构化内容块数组（与 text 二选一）", items: { type: "object" } },
        message_id: { type: "string", description: "当前消息的 ID，通过环境变量 message_id 注入" },
      },
      required: ["message_id"],
      oneOf: [
        { required: ["text"] },
        { required: ["blocks"] },
      ],
    },
    handler: async (params) => {
      const messageId = Number(params.message_id);
      if (!Number.isInteger(messageId) || messageId <= 0) throw new Error("message_id must be a positive integer");
      const text = typeof params.text === "string" ? params.text : undefined;
      const blocks = Array.isArray(params.blocks) ? params.blocks : undefined;
      if (!text && !blocks) throw new Error("Either text or blocks is required");
      const body = blocks ? JSON.stringify({ format: "blocks", blocks: normalizeBlocks(blocks), fallback_text: extractFallbackText(blocks) }) : text!;
      deps.message.setContext(messageId, "mcp_final_body", body);
      return { ok: true };
    },
  };
}

function extractFallbackText(blocks: unknown[]): string {
  return blocks.map(b => {
    const block = b as Record<string, unknown>;
    if (typeof block.text === "string") return block.text;
    if (typeof block.title === "string" && typeof block.question === "string") return `${block.title} ${block.question}`;
    if (typeof block.title === "string") return block.title;
    if (typeof block.summary === "string") return block.summary;
    return "";
  }).filter(Boolean).join("\n\n").trim();
}

const VALID_BLOCK_TYPES = new Set(["text", "rich_text", "markdown", "question", "question_response", "table", "artifact_card", "reference_card", "tool_call_card", "image", "icon", "chart"]);

function normalizeBlocks(blocks: unknown[]): Record<string, unknown>[] {
  return blocks.map((b, i) => {
    if (!b || typeof b !== "object") throw new Error(`blocks[${i}] must be an object`);
    const block = b as Record<string, unknown>;
    if (typeof block.type !== "string" || !VALID_BLOCK_TYPES.has(block.type)) {
      throw new Error(`blocks[${i}].type must be one of: ${[...VALID_BLOCK_TYPES].join(", ")}`);
    }
    return block;
  });
}

function createRecordRepoContextTool(deps: IssueServerDeps): MCPTool {
  return {
    name: "record_repo_context",
    description: "将 Issue 的仓库相关信息（分支名、worktree 路径、PR URL 等）记录到 Stage 的 output_artifacts。可通过 stage_id 直接指定，或通过 issue_id 自动查找活跃 stage。",
    inputSchema: {
      type: "object",
      properties: {
        stage_id: { type: "string", description: "Stage 的数据库 UUID（与 issue_id 二选一）" },
        issue_id: { type: "string", description: "Issue 编号，自动查找活跃 stage（与 stage_id 二选一）" },
        entries: { type: "object", description: "要写入的 key-value 对", additionalProperties: { type: "string" } },
      },
      required: ["entries"],
    },
    handler: async (params) => {
      const entries = params.entries as Record<string, string>;
      if (!entries || typeof entries !== "object") throw new Error("entries must be an object");

      let stageId = typeof params.stage_id === "string" ? params.stage_id : undefined;
      const issueId = typeof params.issue_id === "string" ? params.issue_id : undefined;
      if (stageId && issueId) throw new Error("Cannot specify both stage_id and issue_id, use one");
      if (!stageId && !issueId) throw new Error("Either stage_id or issue_id is required");
      if (!stageId) {
        const stages = deps.stage.listStages(issueId!);
        const active = stages.find(s => !s.left_at) ?? stages.at(-1);
        if (!active) throw new Error(`No stage found for issue: ${issueId}`);
        stageId = active.id;
      }

      deps.stage.addOutputArtifacts(stageId, entries);
      const stage = deps.stage.findStage(stageId);
      return { ok: true, stage_id: stageId, issue_id: stage?.issue_id, output_artifacts: stage?.output_artifacts };
    },
  };
}

function createSetTaskAnchorTool(deps: IssueServerDeps): MCPTool {
  return {
    name: "set_task_anchor",
    description: "将 Issue 的任务锚写入数据库。任务锚结构化记录本质目标、反目标、语义不变量和成功标准。",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: { type: "string", description: "Issue 编号" },
        task_anchor: { type: "string", description: "任务锚内容" },
      },
      required: ["issue_id", "task_anchor"],
    },
    handler: async (params) => {
      const issueId = String(params.issue_id);
      const taskAnchor = String(params.task_anchor);
      if (!issueId || !taskAnchor) throw new Error("issue_id and task_anchor are required");
      deps.issue.updateTaskAnchor(issueId, taskAnchor);
      return { ok: true, issue_id: issueId, task_anchor: taskAnchor };
    },
  };
}

function createQueryCurrentContextTool(deps: IssueServerDeps): MCPTool {
  return {
    name: "query_current_context",
    description: "查询当前 conversation 关联的完整运行时上下文，包括 Stage 进度与产物、Issue 详情、角色列表与工作规则。",
    inputSchema: {
      type: "object",
      properties: { conversation_id: { type: "string", description: "当前 Conversation ID" } },
      required: ["conversation_id"],
    },
    handler: async (params) => {
      const conversationId = String(params.conversation_id);
      if (!conversationId) throw new Error("conversation_id is required");
      return deps.queryConversationContext(conversationId);
    },
  };
}

function createConversationHistoryTool(deps: IssueServerDeps): MCPTool {
  return {
    name: "conversation_history",
    description: "查询历史消息。支持 6 种模式：search（全文搜索）、recent（最近对话）、page（分页浏览）、window（围绕锚点消息的窗口）、by-ids（按 ID 批量查询）、reindex（重建 FTS5 索引）。",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["search", "recent", "page", "window", "by-ids", "reindex"] },
        query: { type: "string" }, issue_id: { type: "string" }, conversation_id: { type: "string" },
        limit: { type: "number" }, offset: { type: "number" }, anchor_message_id: { type: "number" },
        before: { type: "number" }, after: { type: "number" }, message_ids: { type: "string" },
      },
      required: ["mode"],
    },
    handler: async (params) => {
      const messageIds = typeof params.message_ids === "string" ? params.message_ids.split(",").map(s => s.trim()).filter(Boolean) : undefined;
      return deps.queryConversationHistory({
        mode: String(params.mode), issueId: typeof params.issue_id === "string" ? params.issue_id : undefined,
        conversationId: typeof params.conversation_id === "string" ? params.conversation_id : undefined,
        query: typeof params.query === "string" ? params.query : undefined,
        limit: typeof params.limit === "number" ? params.limit : undefined,
        offset: typeof params.offset === "number" ? params.offset : undefined,
        anchorMessageId: typeof params.anchor_message_id === "number" ? params.anchor_message_id : undefined,
        before: typeof params.before === "number" ? params.before : undefined,
        after: typeof params.after === "number" ? params.after : undefined, messageIds,
      });
    },
  };
}

function createEvolutionCandidateTool(deps: IssueServerDeps): MCPTool {
  return {
    name: "create_evolution_candidate",
    description: "将可演进项写入待治理队列。一次调用原子性创建 evolution_item、issue、stage、conversation。",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" }, title: { type: "string" }, content: { type: "string" },
        tags: { type: "array", items: { type: "string" } }, metadata: { type: "object" },
      },
      required: ["workspace_id", "title", "content"],
    },
    handler: async (params) => deps.createEvolutionCandidate({
      workspaceId: String(params.workspace_id), title: String(params.title), content: String(params.content),
      tags: Array.isArray(params.tags) ? params.tags.filter((t): t is string => typeof t === "string") : undefined,
      metadata: params.metadata,
    }),
  };
}

function createCompleteEvolutionItemTool(deps: IssueServerDeps): MCPTool {
  return {
    name: "complete_evolution_item",
    description: "完成演进项处理，回写结果摘要。在演进治理对话结束前调用。",
    inputSchema: {
      type: "object",
      properties: { evolution_item_id: { type: "string" }, result: { type: "string" } },
      required: ["evolution_item_id", "result"],
    },
    handler: async (params) => {
      const { evolution_item_id, result } = params as { evolution_item_id: string; result: string };
      const item = await deps.updateEvolution(evolution_item_id, { status: "completed", result });
      return { ok: true, item_id: item.id, status: item.status };
    },
  };
}

function createSearchFeatureChainTool(deps: IssueServerDeps): MCPTool {
  return {
    name: "search_feature_chain",
    description: "查询历史 Feature 文档索引。支持 search（全文搜索）、get（获取完整文档）、chain（追溯引用链）。",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["search", "get", "chain"] },
        query: { type: "string" }, id: { type: "string" },
        direction: { type: "string", enum: ["backward", "forward", "both"] }, limit: { type: "number" },
      },
      required: ["mode"],
    },
    handler: async (params) => deps.searchFeatureChain({
      mode: String(params.mode), query: typeof params.query === "string" ? params.query : undefined,
      id: typeof params.id === "string" ? params.id : undefined,
      direction: typeof params.direction === "string" ? params.direction : undefined,
      limit: typeof params.limit === "number" ? params.limit : undefined,
    }),
  };
}
