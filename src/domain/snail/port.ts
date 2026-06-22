import type { AgentEvent, InvokeOptions } from "@infra/acs/model";
import type { Snail, SnailFirstCallRequest, SnailResumeRequest, SnailInvokeResult } from "@domain/snail/model";

/**
 * Snail 端口定义。
 *
 * Snail 是 agent 的上层封装，其他模块只看到 snail，不直接访问 agent。
 * 调用方通过 snail_instance_id 追踪会话，不感知底层 agent session。
 */
export interface SnailPort {
  /** 列出所有 snail 配置 */
  list(): Snail[];

  /** 按 key 查找 snail 配置 */
  findByKey(key: string): Snail | undefined;

  /** 创建 snail 配置 */
  create(snail: Snail): void;

  /** 更新 snail 配置 */
  update(key: string, snail: Omit<Snail, 'key'>): void;

  /** 删除 snail 配置 */
  delete(key: string): void;

  /**
   * 首次调用：注入完整配置，返回 snail_instance_id。
   *
   * snail 内部负责：
   * - 创建 SnailInstance（snail_key#随机6位）
   * - 调用 agent runtime，记录返回的 session_id
   * - 返回 snail_instance_id 给调用方
   */
  invokeFirstCall(
    snailKey: string,
    request: SnailFirstCallRequest,
    onEvent: (event: AgentEvent) => void,
    options?: InvokeOptions,
  ): Promise<SnailInvokeResult>;

  /**
   * 后续调用：通过 snail_instance_id 恢复会话。
   *
   * snail 内部负责：
   * - 根据 snail_instance_id 查找 SnailInstance
   * - 取最新 session_id 恢复 agent 会话
   * - 如果 agent 返回新 session_id，追加到 instance
   */
  invokeResume(
    snailInstanceId: string,
    request: SnailResumeRequest,
    onEvent: (event: AgentEvent) => void,
    options?: InvokeOptions,
  ): Promise<SnailInvokeResult>;
}
