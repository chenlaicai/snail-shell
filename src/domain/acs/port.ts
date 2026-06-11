import type { FirstCallRequest, ResumeRequest, AgentEvent, InvokeResult, InvokeOptions } from "./model";

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

  /**
   * 首次调用：传入完整上下文（prompt + capabilities + security + 全量消息）。
   *
   * 流式事件通过 onEvent 回调实时传递。
   * 返回 InvokeResult（含 sessionId，供后续 invokeResume 使用）。
   */
  invokeFirstCall(
    request: FirstCallRequest,
    onEvent: (event: AgentEvent) => void,
    options?: InvokeOptions,
  ): Promise<InvokeResult>;

  /**
   * 后续调用：传入 sessionId + 增量消息。
   *
   * 流式事件通过 onEvent 回调实时传递。
   * 返回 InvokeResult（含 sessionId，供后续调用使用）。
   */
  invokeResume(
    request: ResumeRequest,
    onEvent: (event: AgentEvent) => void,
    options?: InvokeOptions,
  ): Promise<InvokeResult>;
}

/**
 * Agent Registry 端口：管理 agent runtime 类的注册和查询。
 *
 * 用于 snail 模块根据 name 获取 agent 实现类，然后创建实例。
 */
export interface AgentRegistryPort {
  /** 获取 agent 运行时类（返回类本身，调用方自行 new 创建实例） */
  getAgentRuntimeClass(name: string): (new () => AgentRuntimePort) | undefined;

  /** 列出所有已注册的 agent runtime 名称 */
  listAgentRuntimes(): string[];

  /** 检查指定 name 是否已注册 */
  hasAgentRuntime(name: string): boolean;
}
