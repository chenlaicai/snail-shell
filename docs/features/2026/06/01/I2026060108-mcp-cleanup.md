---
id: I2026060108
title: "[agent][mcp] MCP 机制重构：模块独立、两层声明、协议合规"
from_ids: [I2026052605, I2026052909, I2026052604]
tags: [mcp, refactoring, architecture, agent-protocol]
modules: [mcp, agent, web]
---
# I2026060108 MCP 机制重构：模块独立、两层声明、协议合规

## 背景

MCP 机制经过三次迭代（F2026052605 / F2026052909 / F2026052604），功能可用但存在架构问题：

1. **代码散落**：MCP 逻辑分布在 5 个不同模块（server.ts / mcp-config.ts / message-protocol.ts / builder.ts / mcp-center-view.js），无独立模块
2. **无两层声明**：MCP server 声明在 builder.ts 硬编码，没有平台层 + workspace 层的合并机制（skills/prompts 已有此模式）
3. **配置语义模糊**：`.mcp.json` 混合了 Snail Shell 运行时注入和用户自定义，且持久化到用户工作目录
4. **协议合规缺失**：`initialize` 响应缺少 `protocolVersion`，server name 绑定单一工具
5. **main.ts 职责过重**：MCP server 启动逻辑内嵌在 main.ts 中

## 目标

1. 创建独立 `src/mcp/` 模块，MCP server 启动、endpoint、工具定义、registry 全部收入其中
2. 实现 MCP 两层声明：平台 MCP（代码注册）+ workspace MCP（`.snail/mcp.json`），遵循 skills/prompts 的合并模式
3. main.ts 只需一行 `startMcpServer(app, store, PORT)` 指向 `src/mcp/`
4. 运行时 MCP 配置通过临时文件注入，不写用户目录的 `.mcp.json`
5. MCP endpoint 符合协议规范
6. 清理代码级问题

## 非目标

- 不引入 `@modelcontextprotocol/sdk`
- 不新增 MCP tool
- 不支持 MCP Resources / Prompts / Sampling

## 设计

### 任务锚

#### 本质目标
将 MCP 从"散落在 5 个模块的硬编码实现"重构为"独立模块 + 平台/workspace 两层声明 + 运行时注入"的清晰架构，与 skills/prompts 模式一致。

#### 反目标
- 不得在 builder.ts 或 UI 中硬编码 MCP server 名称或 URL
- 不得将 Snail Shell 运行时 MCP 配置持久化到用户工作目录
- 不得为兼容旧架构保留桥接层
- 不得在 main.ts 中内嵌 MCP 相关逻辑（启动、注册、配置写入）

#### 语义不变量
- `set_final_body` 工具功能语义不变
- MCP 终态优先级不变：`mcp_final_body` 优先于 auto-derive
- `<mcp_context>` 注入机制不变
- agent adapter 配置写入目标不变（Claude Code → `--mcp-config`，OpenCode → `opencode.json`，Codex → `config.toml`）

#### 成功标准
- TypeScript 编译通过
- 现有测试通过
- `server.ts` 不再包含 MCP 代码
- `builder.ts` 不再硬编码 MCP server
- `main.ts` 不再包含 MCP 逻辑（只调 `startMcpServer`）
- MCP 两层声明可用：平台 MCP + workspace MCP 合并后注入 ACS
- MCP endpoint `initialize` 返回 `protocolVersion`

### 核心概念：两层 MCP 声明

遵循 skills / prompts 的平台 + workspace 两层模式：

| 层级 | 数据源 | 加载时机 | 示例 |
|------|--------|---------|------|
| **平台 MCP** | 代码注册（`registerMcpServer`） | server 启动时 | `snail-final-response`（Snail Shell 自身暴露给 agent 的 MCP） |
| **Workspace MCP** | `.snail/mcp.json` 文件 | 每次构建 ACS 时 | 用户为该 workspace 配置的 MCP（如 github-mcp） |

合并策略：**Map by name，同名报错**（不允许平台和 workspace 同名，启动时阻断）。

平台 MCP 用代码注册而非文件声明，因为其 URL 依赖运行时 PORT，无法静态写入文件。这与 skills/prompts 的文件声明模式不同，但语义一致——都是"平台提供的基础能力"。

### 命名

- MCP server name：`snail-final-response`（简洁，描述功能而非技术）
- Endpoint path：`POST /snail-final-response`（与 server name 一致）
- 替代原来的 `snail-final-body` / `snail-shell-mcp` / `/mcp`

### 架构总览

```
src/mcp/
├── registry.ts       ← 平台 MCP 注册 + 平台/workspace 合并
├── endpoint.ts       ← POST /snail-final-response JSON-RPC endpoint
├── tools.ts          ← MCP 工具定义和 handler
├── startup.ts        ← MCP server 启动入口（main.ts 调用）
└── index.ts          ← 统一导出

main.ts:
  import { startMcpServer } from "./mcp";
  startMcpServer(app, store, PORT);  // 一行搞定

数据流：
startMcpServer(PORT)
  → registerMcpServer({ name: "snail-final-response", url })
  → registerMcpEndpoint(app, store)
              ↓
      MCP Registry
       ┌───────┴───────┐
       ↓               ↓
  平台 MCPs      .snail/mcp.json
  (registry)     (workspace MCPs)
       └───────┬───────┘
               ↓
    collectActiveMcpServers(workspaceRoot)
    ← builder.ts 调用，合并两层
               ↓
        ACS.mcpServers
       ┌───────┼───────┐
       ↓       ↓       ↓
    claude   opencode  codex
    .claude/  ws-local  .codex/
    mcp.json  opencode  config.toml
              .json
```

### 1. MCP 启动入口 (`src/mcp/startup.ts`)

main.ts 只调一行，所有 MCP 启动逻辑在 `src/mcp/` 内部：

```typescript
import type { Express } from "express";
import type { ConversationStore } from "../persistence/store";
import { registerMcpServer } from "./registry";
import { registerMcpEndpoint } from "./endpoint";

/**
 * 启动 MCP server。
 * - 注册平台级 MCP server 到 registry（snail-final-response）
 * - 注册 MCP JSON-RPC endpoint 到 Express app
 *
 * main.ts 调用：startMcpServer(app, store, PORT)
 */
export function startMcpServer(app: Express, store: ConversationStore, port: number): void {
  // 注册平台级 MCP server（URL 由运行时 PORT 决定）
  registerMcpServer({
    name: "snail-final-response",
    url: `http://localhost:${port}/snail-final-response`,
  });

  // 注册 MCP JSON-RPC endpoint
  registerMcpEndpoint(app, store);
}
```

### 2. MCP Registry (`src/mcp/registry.ts`)

平台 MCP 注册点 + 两层合并逻辑。

```typescript
import type { MCPServerCapability } from "../agent/capability";
import fs from "fs";
import path from "path";

/** 平台级 MCP server 列表（server 启动时注册） */
const platformServers: MCPServerCapability[] = [];

/** 注册平台级 MCP server */
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
 * 遵循 skills/prompts 的两层模式：
 * - 平台 MCP：代码注册（registerMcpServer），含 snail-final-response
 * - Workspace MCP：.snail/mcp.json 文件声明
 * - 合并策略：同名报错（启动时阻断，不允许静默覆盖）
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

  return [...merged.values()];
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
    return [];
  }
}
```

### 3. MCP Endpoint (`src/mcp/endpoint.ts`)

从 `server.ts` L561-660 整体抽离：

```typescript
export function registerMcpEndpoint(app: Express, store: ConversationStore): void {
  app.post("/snail-final-response", (req, res) => { ... });
}
```

### 4. MCP Tools (`src/mcp/tools.ts`)

```typescript
export const MCP_TOOLS = [{ name: "set_final_body", ... }];
export const MCP_SERVER_INFO = { name: "snail-final-response", version: "1.0.0" };
export function handleMcpToolCall(store: ConversationStore, params: unknown): unknown { ... }
```

### 5. MCP 协议合规

`initialize` 响应补充 `protocolVersion`：

```typescript
case "initialize":
  result = {
    protocolVersion: "2025-03-26",
    capabilities: { tools: {} },
    serverInfo: MCP_SERVER_INFO,  // name: "snail-final-response"
  };
```

### 6. Builder 改造

**Before**（`builder.ts` L73）：
```typescript
mcpServers: [{ name: "snail-final-body", url: `http://localhost:${process.env.PORT || "3000"}/mcp` }],
```

**After**：
```typescript
import { collectActiveMcpServers } from "../mcp/registry";
// ...
mcpServers: collectActiveMcpServers(context.workspace.workspace_root),
```

### 7. main.ts 改造

**Before**：
```typescript
import { mergeMcpJson } from "./agent/mcp-config";
// ...
mergeMcpJson(path.join(process.cwd(), ".mcp.json"), PORT);
```

**After**：
```typescript
import { startMcpServer } from "./mcp";
// server.listen 回调中：
startMcpServer(app, store, PORT);
```

main.ts 不再有任何 MCP 相关逻辑。

### 8. 配置注入改造 (`src/agent/mcp-config.ts`)

**设计原则**：agent 启动时必然在某个工作区内，配置文件应约束在本工作区目录内，不污染 workspace root 或 global `~` 目录。参考 skills 的 `.claude/skills/` 和 `.agents/skills/` 模式。

#### 各 Agent 配置注入策略

| Agent | 配置路径 | 写入方式 | 说明 |
|-------|---------|---------|------|
| **Claude Code** | `<wsRoot>/.claude/mcp.json` | `--mcp-config` 显式指定 | 工作区本地，不污染 workspace root |
| **Codex** | `<wsRoot>/.codex/config.toml` | `CODEX_HOME` 环境变量 | 修复 bug：当前错误写到 `~/.codex/config.toml` |
| **OpenCode** | `<wsRoot>/opencode.json` | CWD auto-discovery | 工作区本地，OpenCode 原生 mcp schema |

#### Claude Code：`.claude/mcp.json`

**Before**：
```typescript
ensureMcpServers(input.capability.mcpServers, process.cwd());
args.push("--mcp-config", join(process.cwd(), ".mcp.json"));
```

**After**：
```typescript
ensureMcpServers(input.capability.mcpServers, input.workspaceRoot);
args.push("--mcp-config", join(input.workspaceRoot, ".claude", "mcp.json"));
```

写入 `<wsRoot>/.claude/mcp.json`，格式与 `.mcp.json` 一致（含 `mcp-remote` bridge）。Claude Code 通过 `--mcp-config` 绝对路径显式指定，无需 CWD auto-discovery。

#### Codex：`.codex/config.toml`（修复 bug）

**Before**（`writeCodexMcpConfig` 写到 `~/.codex/config.toml`，忽略 `_cwd`）：
```typescript
function writeCodexMcpConfig(servers: MCPServerCapability[], _cwd: string): void {
  const configPath = path.join(process.env.HOME ?? "~", ".codex", "config.toml");
  // ...
}
```

**After**（与 `writeCodexGuardConfig` 一致，使用 `CODEX_HOME` 指向的 `.codex/` 目录）：
```typescript
function writeCodexMcpConfig(servers: MCPServerCapability[], workspaceRoot: string): void {
  const codexDir = path.join(workspaceRoot, ".codex");
  if (!fs.existsSync(codexDir)) fs.mkdirSync(codexDir, { recursive: true });
  const configPath = path.join(codexDir, "config.toml");
  // ...
}
```

`CODEX_HOME` 环境变量已指向 `<wsRoot>/.codex/`（codex.ts:210），Codex CLI 从 `$CODEX_HOME/config.toml` 加载配置。修复后 MCP config 和 guard config 写入同一文件。

#### OpenCode：`opencode.json`（项目级配置）

**发现**：OpenCode 实际上支持项目级配置文件 `opencode.json`（CWD auto-discovery），之前代码注释"不支持 per-workspace 配置"是错误的。

**配置格式**（OpenCode 原生 schema，与标准 `.mcp.json` 不同）：
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "server-name": {
      "type": "local",
      "command": ["npx", "-y", "some-mcp-server"],
      "environment": { "KEY": "value" }
    },
    "remote-server": {
      "type": "remote",
      "url": "http://localhost:3000/sse"
    }
  }
}
```

关键差异：`mcp`（非 `mcpServers`）、`type: "local"`（非 `"stdio"`）、`command` 为数组（合并 command + args）、`environment`（非 `env`）。

**工作区隔离**：OpenCode 以 `workspaceRoot` 为 CWD 启动（`stateful-cli-agent.ts:158`），`opencode.json` 写入 `workspaceRoot`，天然工作区隔离。

**JSONC 解析 bug 修复**：原来的正则 `//.*$` 会误伤 URL 中的 `//`（如 `https://opencode.ai`），改用状态机解析。

### 9. UI 改造

**Before**（`mcp-center-view.js` L3）：
```javascript
const BUILTIN_MCPS = new Set(["snail-final-body"]);
```

**After**：
- `GET /api/meta/mcps` 响应中每条 MCP 标记 `builtin: boolean`
- 前端从 API 数据判断，不再硬编码

### 10. `GET /api/meta/mcps` 改造

**Before**：读取 CWD 的 `.mcp.json`

**After**：
```typescript
const platformServers = getPlatformMcpServers();
const workspaceServers = loadWorkspaceMcpServers(workspaceRoot);
const builtinNames = getBuiltinMcpNames();
const all = [...platformServers, ...workspaceServers]
  .map(s => ({ ...s, builtin: builtinNames.has(s.name) }));
```

需要从请求中获取 workspaceRoot（通过 workspace_id 参数）。

### 11. `.snail/mcp.json` 格式

与标准 `.mcp.json` 格式一致，降低用户学习成本：

```json
{
  "mcpServers": {
    "github-mcp": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    },
    "custom-tool": {
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

### 12. 代码级问题修复

| 问题 | 修复 |
|------|------|
| JSONC 正则误伤 URL 中的 `//` | 改用逐行处理，跳过字符串内的 `//` |
| `npx mcp-remote` 无版本锁定 | 改为 `npx mcp-remote@1` |
| `spec.ts` 中 `mcpServers` 标注 `(TODO)` | 移除过时注释 |
| `MCPServerCapability` 缺少互斥约束 | JSDoc 说明 command 和 url 互斥 |
| TOML 处理 args 空格问题 | 引号包裹含空格的 arg |

## 生效路径

### 新建文件
- `src/mcp/registry.ts` — 平台 MCP 注册 + 两层合并
- `src/mcp/endpoint.ts` — MCP JSON-RPC endpoint
- `src/mcp/tools.ts` — MCP 工具定义和 handler
- `src/mcp/startup.ts` — MCP server 启动入口
- `src/mcp/index.ts` — 统一导出

### 修改文件
- `src/interaction-entry/api/server.ts` — 移除 MCP 内联代码（~100 行），改为 import
- `src/prompt-center/builder.ts` — `collectActiveMcpServers(workspaceRoot)` 替代硬编码
- `src/agent/mcp-config.ts` — Claude Code → `.claude/mcp.json`，Codex → `.codex/config.toml`（修复 bug），OpenCode → `opencode.json`（项目级配置，原生 mcp schema）
- `src/agent/claude-code.ts` — `--mcp-config` 指向 `.claude/mcp.json`
- `src/agent/claude-code-stateful.ts` — 同上，`buildArgs` 增加 `workspaceRoot` 参数
- `src/agent/opencode.ts` — 注释更新：OpenCode 支持项目级 `opencode.json`
- `src/agent/guard-config.ts` — JSDoc 更新：修正 OpenCode 配置能力描述
- `src/main.ts` — `startMcpServer(app, store, PORT)` 替代 `mergeMcpJson`
- `src/web/mcp-center-view.js` — 从 API 读取 builtin 标记
- `src/agent/capability/spec.ts` — 更新注释（注入策略）

### 修改测试
- `tests/agent/mcp-config-test.ts` — 测试 temp file 写入
- `tests/agent/mcp-endpoint-test.ts` — 更新 import 路径 + endpoint path

## 不兼容更新

1. **MCP server name**：`snail-final-body` → `snail-final-response`
2. **Endpoint path**：`/mcp` → `/snail-final-response`
3. **`.mcp.json` 不再写入 workspace root**：Claude Code MCP 配置写入 `.claude/mcp.json`，不再污染 workspace root
4. **Codex MCP 配置修复**：从 `~/.codex/config.toml`（global）改为 `<wsRoot>/.codex/config.toml`（workspace-local）
5. **OpenCode MCP 配置**：从 `~/.config/opencode/opencode.jsonc`（global）改为 `<wsRoot>/opencode.json`（project-level，原生 mcp schema）
6. **平台/workspace 同名冲突报错**：不再静默覆盖，启动时阻断
7. **MCP Center UI 数据源**：从 `.mcp.json` 文件改为 API（registry + .snail/mcp.json 合并）
8. **JSONC 解析修复**：正则 `//.*$` 改为状态机解析，避免误伤 URL 中的 `//`

## 验证

### 自检范围

1. TypeScript 编译通过
2. 现有测试通过
3. 链路完整性：
   - `main.ts` → `startMcpServer` → registry + endpoint
   - `collectActiveMcpServers(workspaceRoot)` → 平台 + workspace 合并
   - `.snail/mcp.json` workspace MCP 正确加载和合并
   - MCP endpoint `POST /snail-final-response` → `set_final_body` → DB → 终态优先
4. `server.ts` 不再包含 MCP 代码
5. `builder.ts` 不再硬编码 MCP server
6. `main.ts` 不再包含 MCP 逻辑
7. `initialize` 返回 `protocolVersion`
