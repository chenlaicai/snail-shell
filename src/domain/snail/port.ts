import type { AgentEvent, InvokeResult, InvokeOptions } from "@infra/acs/model";
import type { Snail, SnailFirstCallRequest, SnailResumeRequest } from "./model";

/**
 * Snail 端口定义。
 *
 * Snail 是 agent 的上层封装，其他模块只看到 snail，不直接访问 agent。
 * snail 负责组装 tenet-prompt、skill、mcp、model 等，上层只传入业务相关参数。
 */
export interface SnailPort {
  /** 列出所有 snail 配置 */
  list(): Snail[];

  /**
   * 首次调用：注入完整配置。
   *
   * snail 内部负责：
   * - 读取 tenet-prompt，按 tags 过滤，组装 system prompt
   * - 读取 skill，组装到 capabilities
   * - 读取 mcp 配置，组装到 capabilities
   * - 设置 model、context_window、invocation_timeout
   * - 将 handbook 放入 system-reminder 的正确位置
   *
   * @param snailId - snail 配置 ID
   * @param request - 首次调用请求（业务相关参数）
   * @param onEvent - 流式事件回调
   * @param options - 调用选项（signal, contextEnv 等）
   * @returns InvokeResult（含 sessionId，供后续 invokeResume 使用）
   */
  invokeFirstCall(
    snailId: string,
    request: SnailFirstCallRequest,
    onEvent: (event: AgentEvent) => void,
    options?: InvokeOptions,
  ): Promise<InvokeResult>;

  /**
   * 后续调用：传入 sessionId 恢复会话。
   *
   * @param snailId - snail 配置 ID
   * @param sessionId - 首次调用返回的 sessionId
   * @param request - 后续调用请求（增量消息 + 动态上下文）
   * @param onEvent - 流式事件回调
   * @param options - 调用选项
   * @returns InvokeResult（含 sessionId）
   */
  invokeResume(
    snailId: string,
    sessionId: string,
    request: SnailResumeRequest,
    onEvent: (event: AgentEvent) => void,
    options?: InvokeOptions,
  ): Promise<InvokeResult>;
}
