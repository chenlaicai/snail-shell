import type { MCPServerConfig, MCPTool } from "@domain/snail-mcp-server/model";
import type { IssueMCPPort } from "@domain/snail-mcp-server/issue-port";

/**
 * snail-issue MCP Server。
 * 用于 agent 操作 issue 生命周期相关的功能。
 *
 * @param issuePort Issue MCP 端口
 */
export function createIssueServer(issuePort: IssueMCPPort): MCPServerConfig {
  return {
    name: "snail-issue",
    version: "1.0.0",
    tools: [
      createRecordRepoContextTool(issuePort),
      createSetTaskAnchorTool(issuePort),
      createContextQueryTool(issuePort),
      createSearchHistoryTool(issuePort),
      createRecentHistoryTool(issuePort),
      createPageHistoryTool(issuePort),
      createWindowHistoryTool(issuePort),
      createHistoryByIdsTool(issuePort),
      createReindexHistoryTool(issuePort),
      createActiveStageTool(issuePort),
      createListStagesForWorkdirTool(issuePort),
    ],
  };
}

function createRecordRepoContextTool(issuePort: IssueMCPPort): MCPTool {
  return {
    name: "record_repo_context",
    description:
      "记录 stage 的 output_artifacts（合并语义）。" +
      "用于将 worktree 路径、分支名、PR URL 等仓库资源信息写入 stage 的 output_artifacts。",
    inputSchema: {
      type: "object",
      properties: {
        stage_id: {
          type: "string",
          description: "Stage ID（优先使用环境变量 SNAIL_CTX_STAGE_ID）",
        },
        entries: {
          type: "object",
          description: "要记录的键值对，如 { worktree_path: '/path', branch_name: 'feature/xxx' }",
        },
      },
      required: ["entries"],
    },
    handler: async (params) => {
      const stageId = (params.stage_id as string) || process.env.SNAIL_CTX_STAGE_ID;
      if (!stageId) {
        throw new Error(
          "stage_id is required. Set SNAIL_CTX_STAGE_ID environment variable or pass stage_id parameter."
        );
      }

      const entries = params.entries as Record<string, unknown>;
      if (!entries || typeof entries !== "object") {
        throw new Error("entries must be a non-null object");
      }

      return issuePort.recordStageContext(stageId, entries);
    },
  };
}

function createSetTaskAnchorTool(issuePort: IssueMCPPort): MCPTool {
  return {
    name: "set_task_anchor",
    description:
      "设置 issue 的 task_anchor。" +
      "任务锚结构化记录本质目标、反目标、语义不变量和成功标准。",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: {
          type: "string",
          description: "Issue ID（优先使用环境变量 SNAIL_CTX_ISSUE_ID）",
        },
        task_anchor: {
          type: "string",
          description: "任务锚内容",
        },
      },
      required: ["task_anchor"],
    },
    handler: async (params) => {
      const issueId = (params.issue_id as string) || process.env.SNAIL_CTX_ISSUE_ID;
      if (!issueId) {
        throw new Error(
          "issue_id is required. Set SNAIL_CTX_ISSUE_ID environment variable or pass issue_id parameter."
        );
      }

      const taskAnchor = params.task_anchor as string;
      if (!taskAnchor) {
        throw new Error("task_anchor is required");
      }

      return issuePort.setTaskAnchor(issueId, taskAnchor);
    },
  };
}

function createContextQueryTool(issuePort: IssueMCPPort): MCPTool {
  return {
    name: "query_context",
    description:
      "查询当前 conversation 的上下文。" +
      "返回 conversation 关联的 stage、issue、role、workspace 等完整上下文。",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: {
          type: "string",
          description: "Conversation ID（优先使用环境变量 SNAIL_CTX_CONVERSATION_ID）",
        },
      },
      required: [],
    },
    handler: async (params) => {
      const conversationId =
        (params.conversation_id as string) || process.env.SNAIL_CTX_CONVERSATION_ID;
      if (!conversationId) {
        throw new Error(
          "conversation_id is required. Set SNAIL_CTX_CONVERSATION_ID environment variable or pass conversation_id parameter."
        );
      }

      return issuePort.queryContext(conversationId);
    },
  };
}

function createSearchHistoryTool(issuePort: IssueMCPPort): MCPTool {
  return {
    name: "search_history",
    description: "全文搜索对话历史。",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: {
          type: "string",
          description: "Issue ID（可选，优先使用环境变量 SNAIL_CTX_ISSUE_ID）",
        },
        conversation_id: {
          type: "string",
          description: "Conversation ID（可选，优先使用环境变量 SNAIL_CTX_CONVERSATION_ID）",
        },
        query: {
          type: "string",
          description: "搜索关键词",
        },
        limit: {
          type: "number",
          description: "返回结果数量限制",
        },
      },
      required: ["query"],
    },
    handler: async (params) => {
      const issueId = (params.issue_id as string) || process.env.SNAIL_CTX_ISSUE_ID;
      const conversationId =
        (params.conversation_id as string) || process.env.SNAIL_CTX_CONVERSATION_ID;

      if (!issueId && !conversationId) {
        throw new Error(
          "Either issue_id or conversation_id is required. " +
            "Set SNAIL_CTX_ISSUE_ID or SNAIL_CTX_CONVERSATION_ID environment variable, " +
            "or pass issue_id or conversation_id parameter."
        );
      }

      return issuePort.searchHistory({
        issueId,
        conversationId,
        query: params.query as string,
        limit: params.limit as number | undefined,
      });
    },
  };
}

function createRecentHistoryTool(issuePort: IssueMCPPort): MCPTool {
  return {
    name: "get_recent_history",
    description: "获取最近的对话消息。",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: {
          type: "string",
          description: "Issue ID（可选，优先使用环境变量 SNAIL_CTX_ISSUE_ID）",
        },
        conversation_id: {
          type: "string",
          description: "Conversation ID（可选，优先使用环境变量 SNAIL_CTX_CONVERSATION_ID）",
        },
        limit: {
          type: "number",
          description: "返回结果数量限制",
        },
      },
      required: [],
    },
    handler: async (params) => {
      const issueId = (params.issue_id as string) || process.env.SNAIL_CTX_ISSUE_ID;
      const conversationId =
        (params.conversation_id as string) || process.env.SNAIL_CTX_CONVERSATION_ID;

      if (!issueId && !conversationId) {
        throw new Error(
          "Either issue_id or conversation_id is required. " +
            "Set SNAIL_CTX_ISSUE_ID or SNAIL_CTX_CONVERSATION_ID environment variable, " +
            "or pass issue_id or conversation_id parameter."
        );
      }

      return issuePort.getRecentHistory({
        issueId,
        conversationId,
        limit: params.limit as number | undefined,
      });
    },
  };
}

function createPageHistoryTool(issuePort: IssueMCPPort): MCPTool {
  return {
    name: "get_page_history",
    description: "分页查询对话历史。",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: {
          type: "string",
          description: "Issue ID（可选，优先使用环境变量 SNAIL_CTX_ISSUE_ID）",
        },
        conversation_id: {
          type: "string",
          description: "Conversation ID（可选，优先使用环境变量 SNAIL_CTX_CONVERSATION_ID）",
        },
        limit: {
          type: "number",
          description: "每页数量",
        },
        offset: {
          type: "number",
          description: "偏移量",
        },
      },
      required: [],
    },
    handler: async (params) => {
      const issueId = (params.issue_id as string) || process.env.SNAIL_CTX_ISSUE_ID;
      const conversationId =
        (params.conversation_id as string) || process.env.SNAIL_CTX_CONVERSATION_ID;

      if (!issueId && !conversationId) {
        throw new Error(
          "Either issue_id or conversation_id is required. " +
            "Set SNAIL_CTX_ISSUE_ID or SNAIL_CTX_CONVERSATION_ID environment variable, " +
            "or pass issue_id or conversation_id parameter."
        );
      }

      return issuePort.getPageHistory({
        issueId,
        conversationId,
        limit: params.limit as number | undefined,
        offset: params.offset as number | undefined,
      });
    },
  };
}

function createWindowHistoryTool(issuePort: IssueMCPPort): MCPTool {
  return {
    name: "get_window_history",
    description: "窗口查询对话历史，围绕锚点消息的上下文。",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: {
          type: "string",
          description: "Conversation ID（优先使用环境变量 SNAIL_CTX_CONVERSATION_ID）",
        },
        anchor_message_id: {
          type: "number",
          description: "锚点消息 ID",
        },
        before: {
          type: "number",
          description: "锚点前的消息数量",
        },
        after: {
          type: "number",
          description: "锚点后的消息数量",
        },
        direction: {
          type: "string",
          enum: ["forward", "backward"],
          description: "查询方向",
        },
      },
      required: ["anchor_message_id"],
    },
    handler: async (params) => {
      const conversationId =
        (params.conversation_id as string) || process.env.SNAIL_CTX_CONVERSATION_ID;
      if (!conversationId) {
        throw new Error(
          "conversation_id is required. Set SNAIL_CTX_CONVERSATION_ID environment variable or pass conversation_id parameter."
        );
      }

      const anchorMessageId = params.anchor_message_id as number;
      if (!anchorMessageId || !Number.isInteger(anchorMessageId) || anchorMessageId <= 0) {
        throw new Error("anchor_message_id must be a positive integer");
      }

      return issuePort.getWindowHistory({
        conversationId,
        anchorMessageId,
        before: params.before as number | undefined,
        after: params.after as number | undefined,
        direction: params.direction as "forward" | "backward" | undefined,
      });
    },
  };
}

function createHistoryByIdsTool(issuePort: IssueMCPPort): MCPTool {
  return {
    name: "get_history_by_ids",
    description: "按 ID 批量查询对话历史。",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: {
          type: "string",
          description: "Conversation ID（优先使用环境变量 SNAIL_CTX_CONVERSATION_ID）",
        },
        message_ids: {
          type: "array",
          items: { type: "number" },
          description: "消息 ID 列表",
        },
      },
      required: ["message_ids"],
    },
    handler: async (params) => {
      const conversationId =
        (params.conversation_id as string) || process.env.SNAIL_CTX_CONVERSATION_ID;
      if (!conversationId) {
        throw new Error(
          "conversation_id is required. Set SNAIL_CTX_CONVERSATION_ID environment variable or pass conversation_id parameter."
        );
      }

      const messageIds = params.message_ids as number[];
      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        throw new Error("message_ids must be a non-empty array");
      }

      return issuePort.getHistoryByIds({
        conversationId,
        messageIds,
      });
    },
  };
}

function createReindexHistoryTool(issuePort: IssueMCPPort): MCPTool {
  return {
    name: "reindex_history",
    description: "重建对话历史索引。",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: {
          type: "string",
          description: "Conversation ID（可选，不传则全局重建）",
        },
      },
      required: [],
    },
    handler: async (params) => {
      return issuePort.reindexHistory({
        conversationId: params.conversation_id as string | undefined,
      });
    },
  };
}

function createActiveStageTool(issuePort: IssueMCPPort): MCPTool {
  return {
    name: "get_active_stage",
    description: "获取 issue 的活跃 stage。",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: {
          type: "string",
          description: "Issue ID（优先使用环境变量 SNAIL_CTX_ISSUE_ID）",
        },
      },
      required: [],
    },
    handler: async (params) => {
      const issueId = (params.issue_id as string) || process.env.SNAIL_CTX_ISSUE_ID;
      if (!issueId) {
        throw new Error(
          "issue_id is required. Set SNAIL_CTX_ISSUE_ID environment variable or pass issue_id parameter."
        );
      }

      const stage = await issuePort.getActiveStage(issueId);
      return { stage };
    },
  };
}

function createListStagesForWorkdirTool(issuePort: IssueMCPPort): MCPTool {
  return {
    name: "list_stages_for_workdir",
    description: "列出所有 stage 的 worktree_path 映射。",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    handler: async () => {
      const stages = await issuePort.listStagesForWorkdir();
      return { stages };
    },
  };
}
