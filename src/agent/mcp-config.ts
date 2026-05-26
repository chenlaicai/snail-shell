import fs from "fs";
import { logger } from "../logger";

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
