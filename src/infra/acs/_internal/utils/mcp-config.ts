/**
 * MCP 配置注入层：将 ACS mcpServers 翻译为各 agent 的原生配置格式并写入磁盘。
 *
 * 配置路径策略（工作区本地化）：
 *  - Claude Code → <workspaceRoot>/.claude/mcp.json（通过 --mcp-config 显式指定）
 *  - Codex → <workspaceRoot>/.codex/config.toml（通过 CODEX_HOME 环境变量加载）
 *  - OpenCode → <workspaceRoot>/opencode.json（CWD auto-discovery，原生 mcp schema）
 */

import fs from "fs";
import path from "path";
import type { MCPServerCapability } from "@infra/acs/model";

function buildMcpRemoteEntry(url: string): { command: string; args: string[] } {
  return { command: "npx", args: ["mcp-remote@1", url] };
}

export function ensureMcpServers(servers: MCPServerCapability[], workspacePath?: string, agentType?: "claude" | "opencode" | "codex"): void {
  if (!servers?.length) return;
  const workspaceRoot = workspacePath ?? process.cwd();

  switch (agentType) {
    case "claude":
      writeClaudeMcpConfig(servers, workspaceRoot);
      break;
    case "opencode":
      writeOpenCodeMcpConfig(servers, workspaceRoot);
      break;
    case "codex":
      writeCodexMcpConfig(servers, workspaceRoot);
      break;
    default:
      writeClaudeMcpConfig(servers, workspaceRoot);
      break;
  }
}

function writeClaudeMcpConfig(servers: MCPServerCapability[], workspacePath: string): void {
  const claudeDir = path.join(workspacePath, ".claude");
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  const mcpJsonPath = path.join(claudeDir, "mcp.json");
  let mcpConfig: Record<string, unknown> = {};

  if (fs.existsSync(mcpJsonPath)) {
    try {
      mcpConfig = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8"));
    } catch {
      console.warn(`[acs] ${mcpJsonPath} 解析失败，保留原文件内容不变`);
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

  syncEnabledMcpjsonServers(claudeDir, Object.keys(existingServers));
}

function syncEnabledMcpjsonServers(claudeDir: string, serverNames: string[]): void {
  const settingsPath = path.join(claudeDir, "settings.json");
  let settings: Record<string, unknown> = {};

  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch {
      console.warn(`[acs] ${settingsPath} 解析失败，保留原文件内容不变`);
      return;
    }
  }

  settings.enabledMcpjsonServers = serverNames;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

function writeOpenCodeMcpConfig(servers: MCPServerCapability[], workspacePath: string): void {
  const configPath = path.join(workspacePath, "opencode.json");
  let config: Record<string, unknown> = {};

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      config = JSON.parse(parseJsonc(raw));
    } catch {
      console.warn(`[acs] ${configPath} 解析失败，保留原文件内容不变`);
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

function writeCodexMcpConfig(servers: MCPServerCapability[], workspacePath: string): void {
  const codexDir = path.join(workspacePath, ".codex");
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

function readConfigFile(configPath: string): string | null {
  if (!fs.existsSync(configPath)) return "";
  try {
    return fs.readFileSync(configPath, "utf-8");
  } catch {
    console.warn(`[acs] ${configPath} 读取失败，保留原文件内容不变`);
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

  for (const [name, serverConfig] of Object.entries(mcpServers)) {
    newLines.push(`[mcp_servers.${name}]`);
    for (const [key, value] of Object.entries(serverConfig)) {
      newLines.push(`${key} = "${value}"`);
    }
    newLines.push("");
  }

  return newLines.join("\n");
}

// JSONC parser (状态机，避免正则误伤 URL 中的 "//")

function scanJsoncString(jsonc: string, pos: number): { token: string; end: number } {
  const chars = ['"'];
  let i = pos + 1;
  while (i < jsonc.length) {
    const c = jsonc[i];
    chars.push(c);
    if (c === "\\") {
      i++;
      if (i < jsonc.length) chars.push(jsonc[i]);
    } else if (c === "\u0022") {
      break;
    }
    i++;
  }
  return { token: chars.join(""), end: i + 1 };
}

function skipJsoncComment(jsonc: string, pos: number): number {
  if (jsonc[pos] !== "/" || pos + 1 >= jsonc.length) return -1;
  const next = jsonc[pos + 1];
  if (next === "/") {
    const lineEnd = jsonc.indexOf("\n", pos);
    return lineEnd === -1 ? jsonc.length : lineEnd;
  }
  if (next === "*") {
    const commentEnd = jsonc.indexOf("*/", pos + 2);
    return commentEnd === -1 ? jsonc.length : commentEnd + 2;
  }
  return -1;
}

function parseJsonc(jsonc: string): string {
  const tokens: string[] = [];
  let pos = 0;

  while (pos < jsonc.length) {
    const ch = jsonc[pos];

    if (ch === '"') {
      const { token, end } = scanJsoncString(jsonc, pos);
      tokens.push(token);
      pos = end;
      continue;
    }

    const afterComment = skipJsoncComment(jsonc, pos);
    if (afterComment >= 0) { pos = afterComment; continue; }

    tokens.push(ch);
    pos++;
  }

  return tokens.join("").replace(/,(\s*[}\]])/g, "$1");
}
