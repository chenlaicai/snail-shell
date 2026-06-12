import type { AgentRuntimePort } from "../port";

/** Agent 运行时类映射：name → 类 */
const classes = new Map<string, new () => AgentRuntimePort>();

/**
 * 注册 agent 运行时类。
 *
 * 注册的是类，不是实例。
 * 同名重复注册抛出错误。
 */
export function registerAgentRuntime(name: string, cls: new () => AgentRuntimePort): void {
  if (classes.has(name)) {
    throw new Error(`[acs] agent runtime "${name}" already registered`);
  }
  classes.set(name, cls);
}

/**
 * 获取 agent 运行时类。
 *
 * 返回类本身，调用方自行 new 创建实例。
 * 未注册的 name 返回 undefined。
 */
export function getAgentRuntimeClass(name: string): (new () => AgentRuntimePort) | undefined {
  return classes.get(name);
}

/**
 * 列出所有已注册的 agent runtime 名称。
 */
export function listAgentRuntimes(): string[] {
  return [...classes.keys()];
}

/**
 * 检查指定 name 是否已注册。
 */
export function hasAgentRuntime(name: string): boolean {
  return classes.has(name);
}
