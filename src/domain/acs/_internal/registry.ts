import type { AgentRuntimePort } from "../port";

type AgentFactory = () => AgentRuntimePort;

const factories = new Map<string, AgentFactory>();
const instances = new Map<string, AgentRuntimePort>();

/**
 * 注册 agent runtime 工厂函数。
 *
 * 注册时不创建实例，首次 get() 时延迟创建。
 * 同名重复注册抛出错误。
 */
export function registerAgentRuntime(name: string, factory: AgentFactory): void {
  if (factories.has(name)) {
    throw new Error(`[acs] agent runtime "${name}" already registered`);
  }
  factories.set(name, factory);
}

/**
 * 获取 agent runtime 实例。
 *
 * 首次调用时延迟创建实例，后续返回缓存实例。
 * 未注册的 name 抛出错误。
 */
export function getAgentRuntime(name: string): AgentRuntimePort {
  const existing = instances.get(name);
  if (existing) return existing;

  const factory = factories.get(name);
  if (!factory) {
    throw new Error(`[acs] agent runtime "${name}" not registered. Available: ${[...factories.keys()].join(", ")}`);
  }

  const instance = factory();
  instances.set(name, instance);
  return instance;
}

/**
 * 列出所有已注册的 agent runtime 名称。
 */
export function listAgentRuntimes(): string[] {
  return [...factories.keys()];
}

/**
 * 检查指定 name 是否已注册。
 */
export function hasAgentRuntime(name: string): boolean {
  return factories.has(name);
}
