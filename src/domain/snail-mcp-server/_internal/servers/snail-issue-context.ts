import type { MCPServerConfig, MCPTool } from "@domain/snail-mcp-server/model";
import type { IssuePort } from "@domain/issue/port";
import type { IssueManagementPort } from "@domain/snail-mcp-server/port";

/** 系统保留 key，禁止 Agent 通过 set_context 写入 */
const RESERVED_KEYS = new Set([
  "issue_id",
  "stage_id",
  "message_id",
  "stage_key",
  "role_instance",
]);

/**
 * Issue Context MCP Server。
 * 提供 Issue 级别上下文的读写工具，以及 Issue 创建工具。
 */
export function createSnailIssueContextServer(issuePort: IssuePort, issueManagement: IssueManagementPort): MCPServerConfig {
  return {
    name: "snail-issue-context",
    version: "1.0.0",
    tools: [
      createSetContextTool(issuePort),
      createGetContextTool(issuePort),
      createCreateIssueTool(issueManagement),
    ],
  };
}

function createSetContextTool(issuePort: IssuePort): MCPTool {
  return {
    name: "set_context",
    description: "设置 Issue 级别的上下文（merge 语义）。用于存储跨 Stage 传递的指针和元数据（文件路径、分支名、PR URL、状态标记）。禁止存放大段文本、检视计划、方案内容 — 这些应写入文件，context 只存文件路径。",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: { type: "string", description: "Issue ID" },
        key: { type: "string", description: "上下文 key（建议格式：{stage_key}.{artifact_name}，如 design.feature_doc_path）" },
        value: { type: "string", description: "上下文 value（应为短文本：路径、URL、状态标记等，禁止大段内容）" },
      },
      required: ["issue_id", "key", "value"],
    },
    handler: async (params) => {
      const issueId = String(params.issue_id);
      const key = String(params.key);
      const value = String(params.value);

      // 验证 key 格式
      if (!key.match(/^[a-zA-Z0-9_.]+$/)) {
        throw new Error(`Invalid key format: ${key}. Key should contain only alphanumeric characters, underscores, and dots.`);
      }

      // 验证 key 不是系统保留 key
      if (RESERVED_KEYS.has(key)) {
        throw new Error(`Reserved key: ${key}. Cannot overwrite system-reserved keys.`);
      }

      await issuePort.updateContext(issueId, { [key]: value });

      return { success: true, key };
    },
  };
}

function createGetContextTool(issuePort: IssuePort): MCPTool {
  return {
    name: "get_context",
    description: "获取 Issue 级别的上下文",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: { type: "string", description: "Issue ID" },
        key: { type: "string", description: "上下文 key（可选，不传返回全部）" },
      },
      required: ["issue_id"],
    },
    handler: async (params) => {
      const issueId = String(params.issue_id);
      const key = params.key ? String(params.key) : undefined;

      const issue = issuePort.findIssue(issueId);
      if (!issue) {
        throw new Error(`Issue not found: ${issueId}`);
      }

      if (key) {
        // 返回单个 key 的值
        const value = issue.context[key];
        return { value: value ?? null };
      } else {
        // 返回完整上下文
        return { context: issue.context };
      }
    },
  };
}

function createCreateIssueTool(issueManagement: IssueManagementPort): MCPTool {
  return {
    name: "create_issue",
    description: "创建新 Issue。可指定前序 Issue 建立继承关系。创建后新 Issue 的首个 Stage 自动启动。",
    inputSchema: {
      type: "object",
      properties: {
        workspace_path: { type: "string", description: "工作区路径，通过环境变量 SNAIL_CTX_WORKSPACE_PATH 注入" },
        title: { type: "string", description: "Issue 标题" },
        sop_key: { type: "string", description: "采用的 SOP key（如 \"code-delivery\"、\"general-assistant\"）" },
        summary: { type: "string", description: "Issue 摘要，用于承接前序 Issue 的上下文和洞察" },
        source_issue_id: { type: "string", description: "前序 Issue ID，用于建立继承关系。传入后系统在新 Issue 的 context 中写入 source_issue_id 字段。通常传入当前 Issue 的 ID。" },
      },
      required: ["workspace_path", "title", "sop_key"],
    },
    handler: async (params) => {
      const workspacePath = String(params.workspace_path);
      const title = String(params.title);
      const sopKey = String(params.sop_key);
      const summary = params.summary ? String(params.summary) : undefined;
      const sourceIssueId = params.source_issue_id ? String(params.source_issue_id) : undefined;

      const result = await issueManagement.spawnIssue({
        workspace_path: workspacePath,
        title,
        summary,
        adopted_sop_key: sopKey,
        source_issue_id: sourceIssueId,
      });

      return {
        issue_id: result.issue.id,
        issue_title: result.issue.title,
        stage_id: result.stage.id,
        stage_key: result.stage.key,
      };
    },
  };
}
