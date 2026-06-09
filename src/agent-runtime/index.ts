/**
 * Agent Runtime 模块
 *
 * 提供 Agent 运行时适配、进程管理的领域功能。
 *
 * 架构说明：
 * - types: 公开类型定义
 * - resolver: Resolver 接口定义
 * - errors: 错误处理工具
 * - internal: 私有实现（在 database 模块中）
 *
 * 依赖倒置：
 * - 本模块定义 Resolver 接口
 * - database 模块实现这些接口
 * - 本模块通过接口访问运行时
 */

// ═══ 公开类型 ═══
export type {
  AgentRuntime,
  AgentRuntimeType,
  AgentInvocationOptions,
  AgentInvocationResult,
  AgentEvent,
  AgentEventType,
  AgentMessage,
  AgentInvocationInput,
  SnailRuntime,
} from "./types";

// ═══ Resolver 接口 ═══
export type { RuntimeResolver } from "./resolver";

// ═══ 错误处理 ═══
export { summarizeRuntimeError, classifyRuntimeError } from "./errors";
