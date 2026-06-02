/**
 * MCP Registry — 平台 MCP 注册 + 两层合并。
 *
 * 平台 MCP：代码注册（registerMcpServer），server 启动时注册，含 snail-final-response
 * Workspace MCP：.snail/mcp.json 文件声明，每次构建 ACS 时加载
 * 合并策略：同名报错（不允许平台和 workspace 同名，启动时阻断）
 */

import type { MCPServerCapability } from "../agent/capability";
import fs from "fs";
import path from "path";

/** 平台级 MCP server 列表（server 启动时注册） */
const platformServers: MCPServerCapability[] = [];

/** 注册平台级 MCP server（同名则更新） */
export function registerMcpServer(server: MCPServerCapability): void {
  const existing = platformServers.findIndex(s => s.name === server.name);
  if (existing >= 0) {
    platformServers[existing] = server;
  } else {
    platformServers.push(server);
  }
}

/**
 * 合并平台 MCP + workspace MCP，返回最终的 MCP server 列表。
 *
 * @throws 同名冲突时抛出 Error，阻止 server 启动
 */
export function collectActiveMcpServers(workspaceRoot?: string): MCPServerCapability[] {
  const merged = new Map<string, MCPServerCapability>();

  // 平台 MCP 先入
  for (const server of platformServers) {
    merged.set(server.name, server);
  }

  // Workspace MCP：同名检测，冲突则报错
  if (workspaceRoot) {
    const workspaceServers = loadWorkspaceMcpServers(workspaceRoot);
    for (const server of workspaceServers) {
      if (merged.has(server.name)) {
        throw new Error(
          `MCP server name conflict: "${server.name}" is registered by both platform and workspace (${workspaceRoot}). ` +
          `MCP server names must be unique across platform and workspace.`
        );
      }
      merged.set(server.name, server);
    }
  }

  /** 防御性拷贝：阻止调用方通过返回值引用修改内部 registry 状态 */
  return [...merged.values()];
}

/** 获取平台 MCP server 列表（只读副本） */
export function getPlatformMcpServers(): MCPServerCapability[] {
  return [...platformServers];
}

/** 获取内置 MCP server 名称集合（供 UI 区分内置/用户自定义） */
export function getBuiltinMcpNames(): Set<string> {
  return new Set(platformServers.map(s => s.name));
}

/** 从 .snail/mcp.json 加载 workspace 级 MCP server */
function loadWorkspaceMcpServers(workspaceRoot: string): MCPServerCapability[] {
  const mcpJsonPath = path.join(workspaceRoot, ".snail", "mcp.json");
  if (!fs.existsSync(mcpJsonPath)) return [];

  try {
    const raw = fs.readFileSync(mcpJsonPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.mcpServers !== "object" || parsed.mcpServers === null) return [];

    return Object.entries(parsed.mcpServers).map(([name, config]) => {
      const c = config as Record<string, unknown>;
      return {
        name,
        command: typeof c.command === "string" ? c.command : undefined,
        args: Array.isArray(c.args) ? c.args as string[] : undefined,
        env: typeof c.env === "object" && c.env !== null ? c.env as Record<string, string> : undefined,
        url: typeof c.url === "string" ? c.url : undefined,
      };
    });
  } catch {
    /** 容错：.snail/mcp.json 解析失败时不阻断 server 启动，降级为无 workspace MCP */
    return [];
  }
}
