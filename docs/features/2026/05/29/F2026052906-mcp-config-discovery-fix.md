---
id: F2026052906
title: "[agent][web] MCP 配置发现修复 + MCPs 一级目录"
from_ids: [F2026052605]
tags: [mcp, agent-protocol, bugfix, web, ui]
modules: [agent, web]
---
# F2026052906 MCP 配置发现修复 + MCPs 一级目录

## 背景

F2026052605 实现了 MCP 最终正文机制，但该功能从未在运行时生效。agent 始终通过 CLI 直接输出最终回复，未调用 `set_final_body` MCP tool。同时，前端没有 MCP 管理界面，用户无法直观查看当前配置了哪些 MCP server。

## 根因分析

`set_final_body` MCP tool 的发现依赖两个条件：
1. `.mcp.json` 文件存在于 agent 的 CWD
2. agent 能解析 `.mcp.json` 中 `url` 字段（HTTP transport）

当前实现存在两个失败点：

### 失败点 1：CWD 不匹配

`ensureMcpServers` 将 `.mcp.json` 写入 `process.cwd()`（server 进程 CWD），而 Claude Code 以 `cwd: input.projectRoot` 启动。两者可能不同，导致 agent 在自己的 CWD 中找不到 `.mcp.json`。

### 失败点 2：OpenCode/Codex 不支持 .mcp.json 自动发现

OpenCode 和 Codex 有自己独立的 MCP 配置系统：
- OpenCode 使用 `~/.config/opencode/opencode.jsonc` 的 `mcpServers` 字段
- Codex 使用 `~/.codex/config.toml` 的 `[mcp_servers.*]` 部分

### 失败点 3：spec.ts 存在 merge conflict markers

`src/agent/capability/spec.ts` 中存在已提交的 `<<<<<<< HEAD` / `=======` / `>>>>>>> origin/main` merge conflict markers，导致 TypeScript 编译失败。

## 目标

1. Claude Code adapter 显式传入 `--mcp-config` 指向 `.mcp.json`，消除 CWD 依赖
2. OpenCode/Codex adapter 写入各自配置文件，确保 MCP 配置生效
3. 清理 `spec.ts` 中的 merge conflict markers
4. 新增"MCPs"一级导航目录，展示所有已配置 MCP server
5. 保留 fallback：agent 未调用 MCP 时退回 auto-derive 逻辑（不变）

## 非目标

- 不修改 MCP server 端点逻辑
- 不支持在线编辑 MCP 配置（只读展示）
- 不支持运行时动态添加/删除 MCP
- 不展示 MCP tool 列表（仅展示 server 级信息）

## 设计

### 修复方案

#### Claude Code adapter

在两个 Claude Code adapter（stateless + stateful）的 spawn args 中添加 `--mcp-config`，显式指向 `process.cwd()/.mcp.json`：

```typescript
// claude-code.ts invokeStateless — 在 args 构建后、spawnProcess 前
args.push("--mcp-config", join(process.cwd(), ".mcp.json"));
```

**为什么选 `--mcp-config` 而非修改 CWD**：
- `--mcp-config` 是 Claude Code 官方支持的 CLI 参数，语义明确
- 不改变 agent 的工作目录，不影响 agent 的文件操作上下文
- `--mcp-config` 是 additive（不替换其他 MCP 来源），不会破坏用户在 `~/.claude/settings.json` 中配置的其他 MCP server

#### OpenCode/Codex adapter

修改 `ensureMcpServers` 函数，新增 `agentType` 参数，支持写入 agent 特定的配置文件：

```typescript
export function ensureMcpServers(servers: MCPServerCapability[], cwd?: string, agentType?: "opencode" | "codex"): void
```

- OpenCode: 写入 `~/.config/opencode/opencode.jsonc` 的 `mcpServers` 字段
- Codex: 写入 `~/.codex/config.toml` 的 `[mcp_servers.*]` 部分

#### MCPs 一级目录

新增"MCPs"一级导航目录，与项目管理、知识中心等并列：
- 数据源：`GET /api/meta/mcps` 读取 `process.cwd()/.mcp.json`
- UI 结构：遵循 `skill-center-view.js` 模式（左侧列表 + 右侧详情）
- 列表项显示名称 + transport 标签（HTTP/stdio）

### spec.ts 冲突解决

保留 HEAD 版本（包含 HTTP transport 说明和当前注入策略），更新注入策略注释以反映 `--mcp-config` 修复。

## 生效路径

- `src/agent/claude-code.ts` — `invokeStateless` 添加 `--mcp-config`
- `src/agent/claude-code-stateful.ts` — `buildArgs` 添加 `--mcp-config`
- `src/agent/mcp-config.ts` — `ensureMcpServers` 新增 `agentType` 参数
- `src/agent/opencode.ts` — 调用 `ensureMcpServers` 时传入 `"opencode"`
- `src/agent/codex.ts` — 调用 `ensureMcpServers` 时传入 `"codex"`
- `src/agent/capability/spec.ts` — 清理 merge conflict markers
- `src/interaction-entry/api/server.ts` — 新增 `GET /meta/mcps` 端点
- `src/web/mcp-center-view.js` — **新建**：MCP Center 视图
- `src/web/styles/components/mcp-center.css` — **新建**：MCP Center 样式
- `src/web/ui-shell.js` — nav 按钮 + 主面板
- `src/web/primary-view.js` — PRIMARY_VIEWS + applyPrimaryView
- `src/web/app.js` — DOM 引用 + 控制器 + 事件绑定

## 验证

1. TypeScript 编译通过
2. ESLint 通过
3. 现有测试通过（`tests/agent/mcp-config-test.ts`、`tests/agent/mcp-endpoint-test.ts`）
4. 运行时验证：agent spawn 时 args 包含 `--mcp-config <path>/.mcp.json`
5. 手动验证：启动 server → 点击 MCPs → 显示 snail-final-body（HTTP）
