import type { MCPServerConfig, JsonRpcRequest, JsonRpcResponse } from "@domain/snail-mcp-server/model";

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
