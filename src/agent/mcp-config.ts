/**
 * MCP 配置注入层：将 ACS mcpServers 翻译为各 agent 的原生配置格式并写入磁盘。
 *
 * 配置路径策略（工作区本地化）：
 *  - Claude Code → <wsRoot>/.claude/mcp.json（通过 --mcp-config 显式指定）
 *  - Codex → <wsRoot>/.codex/config.toml（通过 CODEX_HOME 环境变量加载）
 *  - OpenCode → <wsRoot>/opencode.json（CWD auto-discovery，原生 mcp schema）
 */

import fs from "fs";
import * as path from "path";
import { logger } from "../logger";
import type { MCPServerCapability } from "./capability";
import { parseJsonc } from "./jsonc-utils";

/**
 * 构建 mcp-remote 桥接配置条目。
 *
 * Claude Code .mcp.json schema 仅支持 stdio transport（command + args），
 * 不支持 HTTP/SSE transport 的 url 字段。
 * mcp-remote 是官方推荐的桥接方案：启动一个本地 stdio 进程，
 * 将 stdin/stdout 转发到远程 HTTP MCP endpoint。
 * 使用 npx mcp-remote@1 锁定大版本，避免 breaking change。
 */
function buildMcpRemoteEntry(url: string): { command: string; args: string[] } {
  return { command: "npx", args: ["mcp-remote@1", url] };
}

/**
 * 按 ACS mcpServers 数据确保各 agent 的 MCP 配置文件包含正确的服务器配置。
 *
 * @param servers - MCP 服务器配置列表
 * @param workspaceRoot - 工作区根目录，配置文件写入此目录下
 * @param agentType - agent 类型，决定配置文件格式和路径
 */
export function ensureMcpServers(servers: MCPServerCapability[], workspaceRoot?: string, agentType?: "claude" | "opencode" | "codex"): void {
  if (!servers?.length) return;
  const wsRoot = workspaceRoot ?? process.cwd();

  switch (agentType) {
    case "claude":
      writeClaudeMcpConfig(servers, wsRoot);
      break;
    case "opencode":
      writeOpenCodeMcpConfig(servers, wsRoot);
      break;
    case "codex":
      writeCodexMcpConfig(servers, wsRoot);
      break;
    default:
      /**
       * 默认写入 .claude/mcp.json：builder.ts 调用时不传 agentType（仅注入 mcpServers 到 ACS），
       * 此时需要写入一个通用格式。Claude Code .mcp.json 是最广泛兼容的选择。
       */
      writeClaudeMcpConfig(servers, wsRoot);
      break;
  }
}

/**
 * 写入 Claude Code MCP 配置到 <wsRoot>/.claude/mcp.json。
 * Claude Code 通过 --mcp-config 绝对路径显式指定此文件。
 */
function writeClaudeMcpConfig(servers: MCPServerCapability[], workspaceRoot: string): void {
  const claudeDir = path.join(workspaceRoot, ".claude");
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  const mcpJsonPath = path.join(claudeDir, "mcp.json");
  let mcpConfig: Record<string, unknown> = {};

  if (fs.existsSync(mcpJsonPath)) {
    try {
      mcpConfig = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8"));
    } catch {
      /** 解析失败时保留原文件：用户可能手动编辑了 JSONC 或有非标准内容，覆盖会丢失数据 */
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

  /**
   * 同步 settings.json 的 enabledMcpjsonServers：确保白名单与 mcp.json 中的 server key 一致。
   *
   * 为什么需要这一步：
   * Claude Code 加载 MCP server 需要两道关卡——mcp.json 声明 server + settings.json 白名单放行。
   * 两份配置由不同路径维护时，命名变更容易导致不一致（如 I2026060201：mcp.json 用
   * "snail-final-response" 但白名单仍引用旧名 "snail-final-body"）。
   * 在写入 mcp.json 后立即同步白名单，从根源消除不一致风险。
   *
   * 写入 .claude/settings.json（项目级配置），不影响 .claude/settings.local.json（用户级）。
   */
  syncEnabledMcpjsonServers(claudeDir, Object.keys(existingServers));
}

/**
 * 同步 .claude/settings.json 的 enabledMcpjsonServers 白名单。
 *
 * 读取现有 settings.json → 更新 enabledMcpjsonServers → 写回。
 * 文件不存在时创建；解析失败时保留原文件不变（与 mcp.json 写入策略一致）。
 */
function syncEnabledMcpjsonServers(claudeDir: string, serverNames: string[]): void {
  const settingsPath = path.join(claudeDir, "settings.json");
  let settings: Record<string, unknown> = {};

  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch {
      logger.warn(`${settingsPath} 解析失败，保留原文件内容不变`);
      return;
    }
  }

  settings.enabledMcpjsonServers = serverNames;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

/**
 * 写入 OpenCode MCP 配置到 <wsRoot>/opencode.json。
 *
 * OpenCode 以 workspaceRoot 作为 CWD 启动，从 CWD 自动发现 opencode.json。
 * 配置格式（OpenCode 原生 schema）：
 *  - mcp.<name>.type = "local" | "remote"
 *  - mcp.<name>.command = string[]（合并 command + args）
 *  - mcp.<name>.environment = Record<string, string>
 *  - mcp.<name>.url = string（remote 类型）
 */
function writeOpenCodeMcpConfig(servers: MCPServerCapability[], workspaceRoot: string): void {
  const configPath = path.join(workspaceRoot, "opencode.json");
  let config: Record<string, unknown> = {};

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      config = JSON.parse(parseJsonc(raw));
    } catch {
      logger.warn(`${configPath} 解析失败，保留原文件内容不变`);
      return;
    }
  }

  const existingMcp = (typeof config.mcp === "object" && config.mcp !== null
    ? { ...config.mcp as Record<string, unknown> }
    : {});

  for (const s of servers) {
    if (s.url) {
      existingMcp[s.name] = { type: "remote", url: s.url };
    } else {
      /**
       * OpenCode 原生 schema 将 command 和 args 合并为单个数组（与 Claude Code 分离格式不同），
       * 例如 ["npx", "-y", "some-mcp-server"]。
       */
      const entry: Record<string, unknown> = {
        type: "local",
        command: [s.command, ...(s.args ?? [])],
      };
      if (s.env && Object.keys(s.env).length > 0) {
        entry.environment = s.env;
      }
      existingMcp[s.name] = entry;
    }
  }

  config.mcp = existingMcp;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

/**
 * 写入 Codex MCP 配置到 <wsRoot>/.codex/config.toml。
 * Codex 通过 CODEX_HOME 环境变量指向 .codex/ 目录加载配置。
 * 与 guard config（writeCodexGuardConfig）写入同一文件。
 */
function writeCodexMcpConfig(servers: MCPServerCapability[], workspaceRoot: string): void {
  const codexDir = path.join(workspaceRoot, ".codex");
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true });
  }

  const configPath = path.join(codexDir, "config.toml");
  const configContent = readConfigFile(configPath);
  if (configContent === null) return;

  const existingServers = parseExistingCodexMcpServers(configContent);
  const mergedServers = mergeCodexMcpServers(existingServers, servers);
  const newConfig = rebuildCodexConfig(configContent, mergedServers);
  fs.writeFileSync(configPath, newConfig);
}

/**
 * 读取配置文件。返回值区分两种失败场景：
 * - 文件不存在 → ""（空字符串）：允许后续 rebuildCodexConfig 创建新文件
 * - 读取异常 → null：调用方应中止操作，保留原文件不变
 */
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
      /** Codex TOML 格式要求 args 为单个字符串（空格分隔），不支持数组 */
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

  /**
   * strip-and-rebuild 策略：先移除所有 [mcp_servers.*] 段，再追加合并后的配置。
   * 比原地更新更简单可靠——避免处理 section 顺序、部分更新、空行格式等边界问题。
   */
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

/**
 * 解析 JSONC（带注释的 JSON）为合法 JSON 字符串。
 *
 * 为什么用状态机而非正则：
 * 正则 `//.*$` 会误伤 URL 中的 "//"（如 "https://opencode.ai"），
 * 因为正则无法区分字符串内外的 "//"。状态机逐字符扫描，
 * 通过跟踪"是否在字符串内"来精确跳过注释。
 *
 * 设计决策：
 * - 转义处理（\\）：避免 `\"` 被误判为字符串结束
 * - 未闭合块注释：跳到末尾（容错，避免死循环）
 * - 尾随逗号：JSONC 允许但 JSON.parse 不允许，用正则移除
 *   （正则可能误匹配字符串内的逗号+括号组合，但配置文件中此场景极罕见，可接受）
 */
