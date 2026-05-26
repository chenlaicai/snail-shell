import fs from "fs";
import * as path from "path";
import { logger } from "../logger";
import type { MCPServerCapability } from "./capability";

/**
 * 将 Snail Shell MCP endpoint 合并到 .mcp.json 文件中。
 *
 * 读取已有配置（如存在），添加/更新 snail-final-body 服务器，
 * 保留用户或项目已有的其他 MCP 服务器配置。
 *
 * 安全策略：
 * - 文件不存在 → 创建新的 .mcp.json
 * - 文件可解析 → 只合并 snail-final-body 条目，保留其他所有内容
 * - 文件不可解析 → 不覆盖，记录警告，保留原文件
 */
export function mergeMcpJson(mcpJsonPath: string, port: number): void {
  if (fs.existsSync(mcpJsonPath)) {
    let raw: string;
    try {
      raw = fs.readFileSync(mcpJsonPath, "utf-8");
    } catch {
      logger.warn(`无法读取 ${mcpJsonPath}，跳过 MCP 配置写入`);
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn(`${mcpJsonPath} 解析失败，保留原文件内容不变`);
      return;
    }
    const mcpServers = (typeof parsed.mcpServers === "object" && parsed.mcpServers !== null
      ? { ...parsed.mcpServers as Record<string, unknown> }
      : {});
    mcpServers["snail-final-body"] = { url: `http://localhost:${port}/mcp` };
    parsed.mcpServers = mcpServers;
    fs.writeFileSync(mcpJsonPath, JSON.stringify(parsed, null, 2) + "\n");
    return;
  }

  // 文件不存在，创建新文件
  fs.writeFileSync(mcpJsonPath, JSON.stringify({
    mcpServers: {
      "snail-final-body": { url: `http://localhost:${port}/mcp` },
    },
  }, null, 2) + "\n");
}

/**
 * 按 ACP mcpServers 数据确保 process.cwd()/.mcp.json 包含正确的服务器配置。
 * 合并模式：保留用户已有的 MCP 服务器条目，只添加/更新 Snail Shell 管理的服务器。
 * 每个 adapter invokeMessage 调用此函数以消费 ACP MCP 能力字段。
 */
export function ensureMcpServers(servers: MCPServerCapability[]): void {
  if (!servers?.length) return;
  const mcpJsonPath = path.join(process.cwd(), ".mcp.json");
  let mcpConfig: Record<string, unknown> = {};
  if (fs.existsSync(mcpJsonPath)) {
    try {
      mcpConfig = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8"));
    } catch {
      logger.warn("Failed to parse existing .mcp.json, will overwrite");
    }
  }
  const existingServers = (typeof mcpConfig.mcpServers === "object" && mcpConfig.mcpServers !== null
    ? { ...mcpConfig.mcpServers as Record<string, unknown> }
    : {});
  for (const s of servers) {
    existingServers[s.name] = s.url ? { url: s.url } : { command: s.command, args: s.args, env: s.env };
  }
  mcpConfig.mcpServers = existingServers;
  fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + "\n");
}
