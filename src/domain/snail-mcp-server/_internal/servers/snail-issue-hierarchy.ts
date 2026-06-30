import type { MCPServerConfig, MCPTool } from "@domain/snail-mcp-server/model";
import type { IssuePort } from "@domain/issue/port";
import type { CreateChildIssueInput, IssueSnailAssignmentPlan } from "@domain/issue/model";

export function createIssueHierarchyServer(issuePort: IssuePort): MCPServerConfig {
  return {
    name: "snail-issue-hierarchy",
    version: "1.0.0",
    tools: [
      createChildIssueTool(issuePort),
    ],
  };
}

function createChildIssueTool(issuePort: IssuePort): MCPTool {
  return {
    name: "create_child_issue",
    description: "创建子 issue。在 decomposition stage 中由 agent 调用，逐步拆分项目为子 issue。每个子 issue 可声明依赖关系（DAG），系统实时校验无环。",
    inputSchema: {
      type: "object",
      properties: {
        parent_issue_id: { type: "string", description: "父 issue ID" },
        title: { type: "string", description: "子 issue 标题" },
        scope: { type: "string", description: "子 issue 范围描述" },
        sop_key: { type: "string", description: "使用的 SOP key" },
        depends_on: { type: "array", items: { type: "string" }, description: "依赖的兄弟子 issue ID 列表（可选）" },
        snail_assignment_plan: { type: "object", description: "snail 分配计划（可选，不指定时系统自动分配）" },
        context: { type: "object", description: "初始上下文（可选）" },
      },
      required: ["parent_issue_id", "title", "scope", "sop_key"],
    },
    handler: async (params) => {
      const parentIssueId = params.parent_issue_id as string;
      const title = params.title as string;
      const scope = params.scope as string;
      const sopKey = params.sop_key as string;
      const dependsOn = params.depends_on as string[] | undefined;
      const snailPlan = params.snail_assignment_plan as IssueSnailAssignmentPlan | undefined;
      const context = params.context as Record<string, string> | undefined;

      if (!parentIssueId || !title || !scope || !sopKey) {
        throw new Error("Missing required fields: parent_issue_id, title, scope, sop_key");
      }

      const input: CreateChildIssueInput = {
        parent_issue_id: parentIssueId,
        title,
        scope,
        sop_key: sopKey,
        depends_on: dependsOn,
        snail_assignment_plan: snailPlan,
        context: context ? { ...context, scope } : { scope },
      };

      try {
        const issue = issuePort.createChildIssue(input);
        return {
          issue_id: issue.id,
          validation_errors: [],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          issue_id: null,
          validation_errors: [message],
        };
      }
    },
  };
}
