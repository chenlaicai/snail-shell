/**
 * MCP 配置注入：将 ACS mcpServers 翻译为 Claude Code .claude/mcp.json。
 *
 * 同时同步 settings.json 的 enabledMcpjsonServers 白名单。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { McpServerCapability } from '../../types.js';

/**
 * 确保 .claude/mcp.json 包含 ACS 声明的 MCP server 配置。
 */
export function ensureMcpServers(servers: McpServerCapability[], workspaceRoot: string): void {
  if (servers.length === 0) return;

  const claudeDir = path.join(workspaceRoot, '.claude');
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  const mcpJsonPath = path.join(claudeDir, 'mcp.json');
  let mcpConfig: Record<string, unknown> = {};

  if (fs.existsSync(mcpJsonPath)) {
    try {
      mcpConfig = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));
    } catch {
      // 解析失败时保留原文件
      return;
    }
  }

  const existingServers: Record<string, unknown> =
    typeof mcpConfig.mcpServers === 'object' && mcpConfig.mcpServers !== null
      ? { ...(mcpConfig.mcpServers as Record<string, unknown>) }
      : {};

  for (const s of servers) {
    if (s.url) {
      // HTTP transport → mcp-remote 桥接
      existingServers[s.name] = { command: 'npx', args: ['mcp-remote@1', s.url] };
    } else {
      existingServers[s.name] = { command: s.command, args: s.args, env: s.env };
    }
  }

  mcpConfig.mcpServers = existingServers;
  fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + '\n');

  // 同步 settings.json 白名单
  syncEnabledMcpjsonServers(claudeDir, Object.keys(existingServers));
}

function syncEnabledMcpjsonServers(claudeDir: string, serverNames: string[]): void {
  const settingsPath = path.join(claudeDir, 'settings.json');
  let settings: Record<string, unknown> = {};

  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      return;
    }
  }

  settings.enabledMcpjsonServers = serverNames;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}
