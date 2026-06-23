import type { MCPServerConfig, MCPTool } from "@domain/snail-mcp-server/model";
import type { IssuePort } from "@domain/issue/port";

/**
 * Issue Context MCP Server。
 * 提供 Issue 级别上下文的读写工具。
 */
export function createSnailIssueContextServer(issuePort: IssuePort): MCPServerConfig {
  return {
    name: "snail-issue-context",
    version: "1.0.0",
    tools: [
      createSetContextTool(issuePort),
      createGetContextTool(issuePort),
    ],
  };
}

function createSetContextTool(issuePort: IssuePort): MCPTool {
  return {
    name: "set_context",
    description: "设置 Issue 级别的上下文（merge 语义）",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: { type: "string", description: "Issue ID" },
        key: { type: "string", description: "上下文 key（建议格式：{stage_key}.{artifact_name}）" },
        value: { type: "string", description: "上下文 value" },
      },
      required: ["issue_id", "key", "value"],
    },
    handler: async (params) => {
      const issueId = String(params.issue_id);
      const key = String(params.key);
      const value = String(params.value);

      // 验证 key 格式（建议 SNAIL_CTX_* 格式，但不强制）
      if (!key.match(/^[a-zA-Z0-9_.]+$/)) {
        throw new Error(`Invalid key format: ${key}. Key should contain only alphanumeric characters, underscores, and dots.`);
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
