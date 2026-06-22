import type { MCPServerConfig } from "@domain/snail-mcp-server/model";
import type { StagePort, IssuePort } from "@domain/issue/port";
import type { MessagePort } from "@domain/message/port";

/**
 * snail-issue MCP Server。
 * 提供 Issue/Stage 实体写入操作：产物记录、任务锚设置、最终答复提交。
 */
export function createIssueServer(
  stagePort: StagePort,
  issuePort: IssuePort,
  messagePort: MessagePort,
): MCPServerConfig {
  return {
    name: "snail-issue",
    version: "1.0.0",
    tools: [
      createRecordOutputArtifactsTool(stagePort),
      createSetTaskAnchorTool(issuePort),
      createSetFinalBodyTool(messagePort),
    ],
  };
}

function createRecordOutputArtifactsTool(stagePort: StagePort) {
  return {
    name: "record_output_artifacts",
    description:
      "向当前 Stage 的 output_artifacts 写入键值对（浅合并，不覆盖已有 key）。" +
      "用于记录分支名、worktree 路径、PR URL 等仓库上下文。" +
      "stage_id 从环境变量 SNAIL_CTX_STAGE_ID 获取。" +
      "[HARD] 创建 worktree 或分支后必须调用此工具记录，未记录的资源等同于泄漏。",
    inputSchema: {
      type: "object",
      properties: {
        stage_id: { type: "string", description: "Stage UUID（从环境变量 SNAIL_CTX_STAGE_ID 获取）" },
        artifacts: {
          type: "object",
          description: "键值对，如 { worktree_path, branch_name, pr_url }。值可以是普通字符串或 {value, keep} 对象。",
          additionalProperties: { type: "string" },
        },
      },
      required: ["stage_id", "artifacts"],
    },
    handler: async (params: Record<string, unknown>) => {
      const stageId = String(params.stage_id ?? "");
      if (!stageId) throw new Error("stage_id is required");
      const artifacts = params.artifacts as Record<string, string> | undefined;
      if (!artifacts || typeof artifacts !== "object") throw new Error("artifacts is required");

      const stage = stagePort.findStage(stageId);
      if (!stage) throw new Error(`Stage not found: ${stageId}`);

      stagePort.addOutputArtifacts(stageId, artifacts);

      const updated = stagePort.findStage(stageId);
      return {
        stage_id: stageId,
        issue_id: stage.issue_id,
        output_artifacts: updated?.output_artifacts ?? {},
      };
    },
  };
}

function createSetTaskAnchorTool(issuePort: IssuePort) {
  return {
    name: "set_task_anchor",
    description:
      "设置 Issue 的任务锚点（task_anchor）。" +
      "任务锚是防止 AI 偏离目标的结构化约束文本，包含本质目标、反目标、成功标准等。" +
      "复杂/长任务开始前调用，后续每次关键决策前必须重新对照。",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: { type: "string", description: "Issue UUID" },
        task_anchor: { type: "string", description: "任务锚点内容（Markdown）" },
      },
      required: ["issue_id", "task_anchor"],
    },
    handler: async (params: Record<string, unknown>) => {
      const issueId = String(params.issue_id ?? "");
      if (!issueId) throw new Error("issue_id is required");
      const taskAnchor = typeof params.task_anchor === "string" ? params.task_anchor : "";
      if (!taskAnchor) throw new Error("task_anchor is required");
      if (taskAnchor.length > 2000) throw new Error("task_anchor exceeds 2000 character limit");

      issuePort.setTaskAnchor(issueId, taskAnchor);
      return { issue_id: issueId, task_anchor: taskAnchor };
    },
  };
}

function createSetFinalBodyTool(messagePort: MessagePort) {
  return {
    name: "set_final_body",
    description:
      "提交本次发言的最终答复正文。每次发言结束前必须调用此工具，" +
      "传入你希望展示给用户的完整 Markdown 内容。" +
      "调用后，此正文将作为消息的主要展示内容，流式过程中的中间分析会被折叠。",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "最终答复的 Markdown 正文" },
        message_id: { type: "string", description: "当前消息的 ID，通过环境变量 message_id 注入" },
      },
      required: ["text", "message_id"],
    },
    handler: async (params: Record<string, unknown>) => {
      const text = typeof params.text === "string" ? params.text : "";
      const messageId = Number(params.message_id);
      if (!text) throw new Error("text is required");
      if (!Number.isInteger(messageId) || messageId <= 0) throw new Error("message_id must be a positive integer");
      messagePort.setContext(messageId, "mcp_final_body", text);
      return { ok: true };
    },
  };
}
