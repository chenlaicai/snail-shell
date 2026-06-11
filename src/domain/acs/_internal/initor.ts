import fs from "fs";
import path from "path";
import { registerAgentRuntime, getAgentRuntimeClass, listAgentRuntimes, hasAgentRuntime } from "./registry";
import type { AgentRuntimePort, AgentRegistryPort } from "../port";

/**
 * 初始化 ACS 模块。
 * 自动扫描 agents 目录下的所有实现类，注册到 registry。
 * 返回 AgentRegistryPort 实现。
 */
export async function init(): Promise<{ registry: AgentRegistryPort }> {
  const agentsDir = path.join(__dirname, "agents");

  // 扫描 agents 目录
  const files = fs.readdirSync(agentsDir).filter(f => f.endsWith(".ts") || f.endsWith(".js"));

  for (const file of files) {
    try {
      const module = await import(path.join(agentsDir, file));

      // 扫描所有导出的类，找到实现了 AgentRuntimePort 的类
      for (const [exportName, exportValue] of Object.entries(module)) {
        if (typeof exportValue === "function" && exportValue.prototype) {
          // 检查是否实现了 AgentRuntimePort（有 name 属性和 invoke 方法）
          const instance = new (exportValue as new () => AgentRuntimePort)();
          if (instance.name && typeof instance.invoke === "function") {
            registerAgentRuntime(instance.name, exportValue as new () => AgentRuntimePort);
            break; // 每个文件只注册一个 agent
          }
        }
      }
    } catch (err) {
      console.warn(`[acs] Failed to load agent from ${file}:`, err);
    }
  }

  // 返回 AgentRegistryPort 实现
  const registry: AgentRegistryPort = {
    getAgentRuntimeClass,
    listAgentRuntimes,
    hasAgentRuntime,
  };

  return { registry };
}
