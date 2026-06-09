/**
 * Agent Capability Builder 接口
 *
 * 定义 Agent 能力构建器的接口。
 *
 * 设计原则：
 * - 接口定义在原子模块中
 * - 实现在 database 模块中
 * - 原子模块通过接口构建能力
 */

import type { AgentCapability, CapabilityBuildContext } from "../types";

/**
 * Agent Capability Builder 接口
 *
 * 定义 Agent 能力构建器的操作。
 */
export interface CapabilityBuilder {
  /**
   * 构建 Agent Capability
   * @param context 构建上下文
   * @returns Agent Capability
   */
  build(context: CapabilityBuildContext): Promise<AgentCapability>;
}
