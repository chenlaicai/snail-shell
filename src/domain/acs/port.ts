import type { AgentRequest, AgentEvent, InvokeResult, InvokeOptions } from "./model";

/**
 * Agent Runtime 端口：Snail Shell 调用 agent 的唯一入口。
 *
 * 每个 agent runtime（Claude Code、Codex、OpenCode）实现此接口。
 * 编排层通过此接口与 agent 交互，不直接访问 agent 的 CLI/API。
 *
 * 所有 agent 均为非交互式调用：调用过程中不暂停等待用户输入。
 * 权限审批、交互确认等由编排层在调用外部处理。
 */
export interface AgentRuntimePort {
  readonly name: string;
  readonly runtime: string;

  /**
   * 调用 agent 处理一条消息。
   *
   * 首次调用：传入 FirstCallRequest（prompt + capabilities + security + 全量消息）。
   * 后续调用：传入 ResumeRequest（sessionId + 增量消息）。
   *
   * 流式事件通过 onEvent 回调实时传递。
   * 返回 InvokeResult（含 sessionId，供后续 ResumeRequest 使用）。
   */
  invoke(
    request: AgentRequest,
    onEvent: (event: AgentEvent) => void,
    options?: InvokeOptions,
  ): Promise<InvokeResult>;
}
