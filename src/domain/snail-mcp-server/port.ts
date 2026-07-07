import type { MCPServerConfig, JsonRpcRequest, JsonRpcResponse } from "@domain/snail-mcp-server/model";
import type { Issue, Stage } from "@domain/issue/model";

/** Snail MCP Server 端口定义 */
export interface SnailMCPServerPort {
  /** 注册 MCP Server */
  registerServer(config: MCPServerConfig): void;

  /** 获取所有已注册的 Server */
  listServers(): MCPServerConfig[];

  /** 按名称查找 Server */
  findServer(name: string): MCPServerConfig | undefined;

  /** 处理 JSON-RPC 请求 */
  handleRequest(serverName: string, request: JsonRpcRequest): Promise<JsonRpcResponse>;
}

/** 阶段推进校验原因 */
export interface TransitionValidationReason {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  details?: Record<string, unknown>;
}

/** 阶段推进请求结果 */
export type TransitionRequestResult =
  | { valid: true; registered: true }
  | { valid: false; reasons: TransitionValidationReason[] };

/** 阶段推进端口：MCP 工具通过此端口请求阶段推进 */
export interface StageTransitionPort {
  requestTransition(input: {
    stageId: string;
    fromSpeaker: string;
    targetKey: string;
    signalType?: string;
    reason: string;
  }): Promise<TransitionRequestResult>;
}

/** Issue 管理端口：MCP 工具通过此端口创建新 Issue */
export interface IssueManagementPort {
  spawnIssue(input: {
    workspace_path: string;
    title: string;
    summary?: string;
    adopted_sop_key: string;
    source_issue_id?: string;
  }): Promise<{ issue: Issue; stage: Stage }>;
}
