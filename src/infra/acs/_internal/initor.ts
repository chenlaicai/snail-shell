import fs from "fs";
import path from "path";
import { registerAgentRuntime, getAgentRuntimeClass, listAgentRuntimes, hasAgentRuntime } from "@infra/acs/_internal/registry";
import type { AgentRuntimePort, AgentRegistryPort } from "@infra/acs/port";
import { getLogger } from "@infra/logger";

const log = getLogger({ module: "acs" });

/**
 * 初始化 ACS 模块。
 * 自动扫描 agents 目录下的所有实现类，注册到 registry。
 * 返回 AgentRegistryPort 实现。
 */
export async function init(): Promise<{ registry: AgentRegistryPort }> {
  const agentsDir = path.join(__dirname, "agents");

  // 扫描 agents 目录
  const files = fs.readdirSync(agentsDir).filter(isRuntimeModuleFile);

  for (const file of files) {
    try {
      const module = await import(path.join(agentsDir, file));
      registerRuntimeFromModule(module);
    } catch (err) {
      log.warn({ file, err }, "Failed to load agent");
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

function isRuntimeModuleFile(file: string): boolean {
  if (file.endsWith(".d.ts")) return false;
  return file.endsWith(".ts") || file.endsWith(".js");
}

function registerRuntimeFromModule(module: Record<string, unknown>): void {
  for (const exportValue of Object.values(module)) {
    if (typeof exportValue !== "function" || !exportValue.prototype) continue;
    const runtimeClass = exportValue as new () => AgentRuntimePort;
    const instance = new runtimeClass();
    if (isAgentRuntime(instance)) {
      registerAgentRuntime(instance.name, runtimeClass);
      return;
    }
  }
}

function isAgentRuntime(instance: AgentRuntimePort): boolean {
  return Boolean(instance.name && typeof instance.invokeFirstCall === "function" && typeof instance.invokeResume === "function");
}
