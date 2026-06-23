import type { MCPServerConfig, MCPTool } from "@domain/snail-mcp-server/model";
import type { MessagePort } from "@domain/message/port";
import type { StagePort } from "@domain/issue/port";
import type { IssuePort } from "@domain/issue/port";

// ── Dependency types for complex queries ──────────────────────────────

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
  queryConversationHistory: (params: {
    mode: string;
    issueId?: string;
    conversationId?: string;
    query?: string;
    limit?: number;
    offset?: number;
    anchorMessageId?: number;
    before?: number;
    after?: number;
    messageIds?: string[];
  }) => unknown;
  createEvolutionCandidate: (params: {
    workspaceId: string;
    title: string;
    content: string;
    tags?: string[];
    metadata?: unknown;
  }) => Promise<EvolutionCandidateResult>;
  searchFeatureChain: (params: {
    mode: string;
    query?: string;
    id?: string;
    direction?: string;
    limit?: number;
  }) => FeatureChainResult;
}

// ── Server factory ────────────────────────────────────────────────────

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

// ── Tool implementations ──────────────────────────────────────────────

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
        blocks: {
          type: "array",
          description: "结构化内容块数组（与 text 二选一）。支持 text/markdown/question/table/artifact_card/reference_card 等类型",
          items: { type: "object" },
        },
        message_id: { type: "string", description: "当前消息的 ID，通过环境变量 message_id 注入" },
      },
      required: ["message_id"],
    },
    handler: async (params) => {
      const messageId = Number(params.message_id);
      if (!Number.isInteger(messageId) || messageId <= 0) throw new Error("message_id must be a positive integer");

      const text = typeof params.text === "string" ? params.text : undefined;
      const blocks = Array.isArray(params.blocks) ? params.blocks : undefined;

      if (!text && !blocks) throw new Error("Either text or blocks is required");

      const body = blocks ? JSON.stringify({ format: "blocks", blocks }) : text!;
      deps.message.setContext(messageId, "mcp_final_body", body);
      return { ok: true };
    },
  };
}

function createRecordRepoContextTool(deps: IssueServerDeps): MCPTool {
  return {
    name: "record_repo_context",
    description:
      "将 Issue 的仓库相关信息（分支名、worktree 路径、PR URL 等）记录到 Stage 的 output_artifacts。" +
      "下一 Stage 的审查者从 input_artifacts 读取 worktree_path 确定检视目录，缺少此记录则审查者无法工作。",
    inputSchema: {
      type: "object",
      properties: {
        stage_id: { type: "string", description: "Stage 的数据库 UUID" },
        entries: {
          type: "object",
          description: "要写入的 key-value 对，如 { branch_name: \"xxx\", worktree_path: \"xxx\", pr_url: \"xxx\" }",
          additionalProperties: { type: "string" },
        },
      },
      required: ["stage_id", "entries"],
    },
    handler: async (params) => {
      const stageId = String(params.stage_id);
      const entries = params.entries as Record<string, string>;
      if (!entries || typeof entries !== "object") throw new Error("entries must be an object");

      deps.stage.addOutputArtifacts(stageId, entries);
      const stage = deps.stage.findStage(stageId);
      return { ok: true, stage_id: stageId, issue_id: stage?.issue_id, output_artifacts: stage?.output_artifacts };
    },
  };
}

function createSetTaskAnchorTool(deps: IssueServerDeps): MCPTool {
  return {
    name: "set_task_anchor",
    description:
      "将 Issue 的任务锚写入数据库。任务锚结构化记录本质目标、反目标、语义不变量和成功标准。" +
      "复杂/长任务开始行动前设置，后续关键决策点必须重新对照。",
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
      if (!issueId) throw new Error("issue_id is required");
      if (!taskAnchor) throw new Error("task_anchor is required");
      deps.issue.updateTaskAnchor(issueId, taskAnchor);
      return { ok: true, issue_id: issueId, task_anchor: taskAnchor };
    },
  };
}

function createQueryCurrentContextTool(deps: IssueServerDeps): MCPTool {
  return {
    name: "query_current_context",
    description:
      "查询当前 conversation 关联的完整运行时上下文，包括 Stage 进度与产物、Issue 详情、角色列表与工作规则、Conversation 元信息。",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: { type: "string", description: "当前 Conversation ID" },
      },
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
    description:
      "查询 Snail Shell conversation 的历史消息。支持 5 种模式：" +
      "search（全文搜索）、recent（最近对话）、page（分页浏览）、window（围绕锚点消息的窗口）、by-ids（按 ID 批量查询）。",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["search", "recent", "page", "window", "by-ids"], description: "查询模式" },
        query: { type: "string", description: "搜索关键词（search 模式必填）" },
        issue_id: { type: "string", description: "Issue ID（跨 conversation 查询）" },
        conversation_id: { type: "string", description: "Conversation ID" },
        limit: { type: "number", description: "返回条数限制" },
        offset: { type: "number", description: "分页偏移（page 模式）" },
        anchor_message_id: { type: "number", description: "锚点消息 ID（window 模式必填）" },
        before: { type: "number", description: "锚点前的消息数（window 模式）" },
        after: { type: "number", description: "锚点后的消息数（window 模式）" },
        message_ids: { type: "string", description: "逗号分隔的消息 ID 列表（by-ids 模式必填）" },
      },
      required: ["mode"],
    },
    handler: async (params) => {
      const messageIds = typeof params.message_ids === "string"
        ? params.message_ids.split(",").map(s => s.trim()).filter(Boolean)
        : undefined;
      return deps.queryConversationHistory({
        mode: String(params.mode),
        issueId: typeof params.issue_id === "string" ? params.issue_id : undefined,
        conversationId: typeof params.conversation_id === "string" ? params.conversation_id : undefined,
        query: typeof params.query === "string" ? params.query : undefined,
        limit: typeof params.limit === "number" ? params.limit : undefined,
        offset: typeof params.offset === "number" ? params.offset : undefined,
        anchorMessageId: typeof params.anchor_message_id === "number" ? params.anchor_message_id : undefined,
        before: typeof params.before === "number" ? params.before : undefined,
        after: typeof params.after === "number" ? params.after : undefined,
        messageIds,
      });
    },
  };
}

function createEvolutionCandidateTool(deps: IssueServerDeps): MCPTool {
  return {
    name: "create_evolution_candidate",
    description:
      "将 agent 在工作中识别到的可演进项写入 Snail Shell 待治理演进候选。" +
      "一次调用会原子性地创建 4 条记录：evolution_item、issue、stage、conversation。候选只进入治理队列，不会自动生效。",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string", description: "所属 workspace id" },
        title: { type: "string", description: "候选标题" },
        content: { type: "string", description: "可长期复用的正文" },
        tags: { type: "array", items: { type: "string" }, description: "标签列表" },
        metadata: { type: "object", description: "结构化补充信息" },
      },
      required: ["workspace_id", "title", "content"],
    },
    handler: async (params) => {
      return deps.createEvolutionCandidate({
        workspaceId: String(params.workspace_id),
        title: String(params.title),
        content: String(params.content),
        tags: Array.isArray(params.tags) ? params.tags.filter((t): t is string => typeof t === "string") : undefined,
        metadata: params.metadata,
      });
    },
  };
}

function createCompleteEvolutionItemTool(deps: IssueServerDeps): MCPTool {
  return {
    name: "complete_evolution_item",
    description: "完成演进项处理，回写结果摘要。在演进治理对话结束前调用。",
    inputSchema: {
      type: "object",
      properties: {
        evolution_item_id: { type: "string", description: "演进项 ID" },
        result: { type: "string", description: "处理结果摘要（Markdown）" },
      },
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
    description:
      "查询历史 Feature 文档的索引，搜索相关特性设计记录。支持 3 种模式：" +
      "search（全文搜索）、get（获取单个 Feature 完整文档）、chain（追溯引用链）。",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["search", "get", "chain"], description: "查询模式" },
        query: { type: "string", description: "搜索关键词（search 模式必填）" },
        id: { type: "string", description: "Feature ID（get/chain 模式必填）" },
        direction: { type: "string", enum: ["backward", "forward", "both"], description: "引用链方向（chain 模式）" },
        limit: { type: "number", description: "返回条数限制" },
      },
      required: ["mode"],
    },
    handler: async (params) => {
      return deps.searchFeatureChain({
        mode: String(params.mode),
        query: typeof params.query === "string" ? params.query : undefined,
        id: typeof params.id === "string" ? params.id : undefined,
        direction: typeof params.direction === "string" ? params.direction : undefined,
        limit: typeof params.limit === "number" ? params.limit : undefined,
      });
    },
  };
}
