import fs from "fs";
import * as path from "path";
import { logger } from "../logger";
import type { MCPServerCapability } from "./capability";

/**
 * 构建 mcp-remote 桥接配置条目。
 *
 * Claude Code .mcp.json schema 不支持 url 字段（HTTP transport），
 * 需要通过 npx mcp-remote 桥接：将 HTTP MCP endpoint 转换为 stdio transport。
 */
function buildMcpRemoteEntry(url: string): { command: string; args: string[] } {
  return { command: "npx", args: ["mcp-remote", url] };
}

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
    mcpServers["snail-final-body"] = buildMcpRemoteEntry(`http://localhost:${port}/mcp`);
    parsed.mcpServers = mcpServers;
    fs.writeFileSync(mcpJsonPath, JSON.stringify(parsed, null, 2) + "\n");
    return;
  }

  // 文件不存在，创建新文件
  fs.writeFileSync(mcpJsonPath, JSON.stringify({
    mcpServers: {
      "snail-final-body": buildMcpRemoteEntry(`http://localhost:${port}/mcp`),
    },
  }, null, 2) + "\n");
}

/**
 * 按 ACP mcpServers 数据确保指定目录的 .mcp.json 包含正确的服务器配置。
 * 合并模式：保留用户已有的 MCP 服务器条目，只添加/更新 Snail Shell 管理的服务器。
 * 每个 adapter invokeMessage 调用此函数以消费 ACP MCP 能力字段。
 *
 * @param servers - MCP 服务器配置列表
 * @param cwd - .mcp.json 写入目录，默认 process.cwd()。各 adapter 应传入 agent 进程的 CWD，
 *              确保 agent 的 auto-discovery 能发现此文件（如 Claude Code --mcp-config、
 *              Codex/OpenCode CWD auto-discovery）。
 * @param agentType - agent 类型，用于写入 agent 特定的 MCP 配置文件（如 OpenCode 的 .opencode.json、
 *                    Codex 的 .codex/config.toml）。如果不指定，只写入 .mcp.json。
 */
export function ensureMcpServers(servers: MCPServerCapability[], cwd?: string, agentType?: "opencode" | "codex"): void {
  if (!servers?.length) return;
  const targetDir = cwd ?? process.cwd();

  // 写入 .mcp.json（Claude Code 使用）
  writeMcpJson(servers, targetDir);

  // 写入 agent 特定的 MCP 配置文件
  if (agentType === "opencode") {
    writeOpenCodeMcpConfig(servers, targetDir);
  } else if (agentType === "codex") {
    writeCodexMcpConfig(servers, targetDir);
  }
}

function writeMcpJson(servers: MCPServerCapability[], targetDir: string): void {
  const mcpJsonPath = path.join(targetDir, ".mcp.json");
  let mcpConfig: Record<string, unknown> = {};

  if (fs.existsSync(mcpJsonPath)) {
    try {
      mcpConfig = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8"));
    } catch {
      logger.warn(`${mcpJsonPath} 解析失败，保留原文件内容不变`);
      return;
    }
  }

  const existingServers = (typeof mcpConfig.mcpServers === "object" && mcpConfig.mcpServers !== null
    ? { ...mcpConfig.mcpServers as Record<string, unknown> }
    : {});

  for (const s of servers) {
    existingServers[s.name] = s.url ? buildMcpRemoteEntry(s.url) : { command: s.command, args: s.args, env: s.env };
  }

  mcpConfig.mcpServers = existingServers;
  fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + "\n");
}

/**
 * 写入 OpenCode MCP 配置到 ~/.config/opencode/opencode.jsonc
 * OpenCode 使用全局配置文件，不支持 per-workspace 配置
 */
function writeOpenCodeMcpConfig(servers: MCPServerCapability[], _cwd: string): void {
  const configPath = path.join(process.env.HOME ?? "~", ".config", "opencode", "opencode.jsonc");
  let config: Record<string, unknown> = {};

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      // opencode.jsonc 可能包含注释，需要先移除
      const cleaned = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      config = JSON.parse(cleaned);
    } catch {
      logger.warn(`${configPath} 解析失败，保留原文件内容不变`);
      return;
    }
  }

  const mcpServers = (typeof config.mcpServers === "object" && config.mcpServers !== null
    ? { ...config.mcpServers as Record<string, unknown> }
    : {});

  for (const s of servers) {
    mcpServers[s.name] = s.url
      ? { url: s.url, type: "sse" }
      : { command: s.command, args: s.args, env: s.env, type: "stdio" };
  }

  config.mcpServers = mcpServers;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

/**
 * 写入 Codex MCP 配置到 ~/.codex/config.toml
 * Codex 使用全局配置文件，不支持 per-workspace 配置
 */
function writeCodexMcpConfig(servers: MCPServerCapability[], _cwd: string): void {
  const configPath = path.join(process.env.HOME ?? "~", ".codex", "config.toml");
  const configContent = readConfigFile(configPath);
  if (configContent === null) return;

  const existingServers = parseExistingCodexMcpServers(configContent);
  const mergedServers = mergeCodexMcpServers(existingServers, servers);
  const newConfig = rebuildCodexConfig(configContent, mergedServers);
  fs.writeFileSync(configPath, newConfig);
}

function readConfigFile(configPath: string): string | null {
  if (!fs.existsSync(configPath)) return "";
  try {
    return fs.readFileSync(configPath, "utf-8");
  } catch {
    logger.warn(`${configPath} 读取失败，保留原文件内容不变`);
    return null;
  }
}

function parseExistingCodexMcpServers(configContent: string): Record<string, Record<string, string>> {
  const mcpServers: Record<string, Record<string, string>> = {};
  const lines = configContent.split("\n");
  let currentServer: string | null = null;

  for (const line of lines) {
    const serverMatch = line.match(/^\[mcp_servers\.(.+)\]$/);
    if (serverMatch) {
      currentServer = serverMatch[1];
      mcpServers[currentServer] = {};
      continue;
    }

    if (currentServer) {
      const kvMatch = line.match(/^(\w+)\s*=\s*"([^"]*)"$/);
      if (kvMatch) {
        mcpServers[currentServer][kvMatch[1]] = kvMatch[2];
      } else if (line.match(/^\[/)) {
        currentServer = null;
      }
    }
  }

  return mcpServers;
}

function mergeCodexMcpServers(
  existing: Record<string, Record<string, string>>,
  servers: MCPServerCapability[],
): Record<string, Record<string, string>> {
  const merged = { ...existing };

  for (const s of servers) {
    if (s.url) {
      merged[s.name] = { url: s.url };
    } else {
      const serverConfig: Record<string, string> = {};
      if (s.command) serverConfig.command = s.command;
      if (s.args) serverConfig.args = s.args.join(" ");
      if (s.env) {
        for (const [key, value] of Object.entries(s.env)) {
          serverConfig[`env.${key}`] = value;
        }
      }
      merged[s.name] = serverConfig;
    }
  }

  return merged;
}

function rebuildCodexConfig(
  configContent: string,
  mcpServers: Record<string, Record<string, string>>,
): string {
  const lines = configContent.split("\n");
  const newLines: string[] = [];
  let inMcpSection = false;

  // 保留非 mcp_servers 部分
  for (const line of lines) {
    if (line.match(/^\[mcp_servers\./)) {
      inMcpSection = true;
      continue;
    }
    if (inMcpSection && line.match(/^\[/)) {
      inMcpSection = false;
    }
    if (!inMcpSection) {
      newLines.push(line);
    }
  }

  // 添加合并后的 mcp_servers 配置
  for (const [name, serverConfig] of Object.entries(mcpServers)) {
    newLines.push(`[mcp_servers.${name}]`);
    for (const [key, value] of Object.entries(serverConfig)) {
      newLines.push(`${key} = "${value}"`);
    }
    newLines.push("");
  }

  return newLines.join("\n");
}
