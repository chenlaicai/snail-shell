# MCP Client 模块分析（v1 遗留）

> 本文档基于 `v1/` 目录下的遗留代码分析，用于指导 v2 重写。

---

## 一、业务场景

### 1.1 MCP Client 是什么

MCP Client 是 Snail Shell 的 **MCP Server 配置管理层**。Snail Shell 自身不直接作为 MCP Client 连接外部 MCP Server，而是将 MCP Server 配置翻译为各 Agent CLI（Claude Code、OpenCode、Codex）的原生配置格式，由 Agent CLI 自身作为实际的 MCP Client 连接。

核心设计：**配置翻译 + 注入**。`ensureMcpServers()` 在每次 Agent 调用前将 `MCPServerCapability[]` 翻译为 Agent 原生配置文件（`.claude/mcp.json`、`opencode.json`、`.codex/config.toml`）。

### 1.2 核心业务场景

| 场景 | 说明 |
|------|------|
| **Claude Code MCP 配置** | 写入 `.claude/mcp.json` + `.claude/settings.json` 白名单，HTTP Server 通过 mcp-remote 桥接 |
| **OpenCode MCP 配置** | 写入 `opencode.json`，支持 local（stdio）和 remote（HTTP）两种类型 |
| **Codex MCP 配置** | 写入 `.codex/config.toml`，TOML 格式，strip-and-rebuild 策略 |
| **Workspace 自定义 MCP Server** | `.snail/mcp.json` 声明的 MCP Server 与平台 Server 合并后注入 |
| **MCP Server 目录展示** | Web 端 McpCenter 页面展示所有活跃 MCP Server，区分 built-in 和用户自定义 |

### 1.3 MCP Client 与其他模块的关系

- **MCP Server（Registry）**：`collectActiveMcpServers()` 合并平台 + workspace MCP Server，提供给 ACS
- **ACS（Agent Capability Spec）**：`AgentCapability.mcpServers` 承载 MCP Server 配置
- **Prompt Center**：`buildConversationCapability()` 调用 `collectActiveMcpServers()` 收集 MCP Server
- **Agent Adapter**：各适配器在 `invokeMessage()` 时调用 `ensureMcpServers()` 写入配置文件
- **Agent CLI**：Claude Code、OpenCode、Codex 自身作为 MCP Client 连接 MCP Server
- **Web UI**：McpCenter 页面展示 MCP Server 列表

---

## 二、数据模型

### 2.1 无数据库表

MCP Client 配置纯文件驱动，不入库。

### 2.2 TypeScript 类型定义

**MCPServerCapability**（通用 MCP Server 描述）：
```typescript
interface MCPServerCapability {
  name: string;
  command?: string;              // stdio transport
  args?: string[];               // stdio transport
  env?: Record<string, string>;  // stdio transport
  url?: string;                  // HTTP transport
}
```

**Workspace MCP 配置文件格式**（`.snail/mcp.json`）：
```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    }
  }
}
```

### 2.3 Agent 原生配置格式

**Claude Code**（`.claude/mcp.json`）：
```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "..." }
    },
    "snail-final-response": {
      "command": "npx",
      "args": ["mcp-remote@1", "http://localhost:3000/snail-final-response"]
    }
  }
}
```

Claude Code 不原生支持 HTTP MCP Server，通过 `mcp-remote@1` 桥接。

**Claude Code Settings**（`.claude/settings.json`）：
```json
{
  "enabledMcpjsonServers": ["server-name", "snail-final-response"]
}
```

必须与 `.claude/mcp.json` 同步，两者都同意才会加载 MCP Server。

**OpenCode**（`opencode.json`）：
```json
{
  "mcp": {
    "server-name": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-github"],
      "environment": { "GITHUB_TOKEN": "..." }
    },
    "snail-final-response": {
      "type": "remote",
      "url": "http://localhost:3000/snail-final-response"
    }
  }
}
```

OpenCode 原生支持 `type: "remote"`（HTTP），无需桥接。

**Codex**（`.codex/config.toml`）：
```toml
[mcp_servers.server-name]
command = "npx"
args = "-y @modelcontextprotocol/server-github"
env.GITHUB_TOKEN = "..."

[mcp_servers.snail-final-response]
url = "http://localhost:3000/snail-final-response"
```

---

## 三、核心流程

### 3.1 MCP Server 收集流程

```
buildConversationCapability() [prompt-center/builder.ts]
  → collectActiveMcpServers(workspaceRoot) [mcp/registry.ts]
    → platformServers（启动时 registerMcpServer 注册）
    + workspaceServers（.snail/mcp.json 加载）
    → 名称冲突 → throw Error
    → 返回 MCPServerCapability[]
  → 放入 AgentCapability.mcpServers
```

### 3.2 MCP 配置注入流程

```
Agent Adapter.invokeMessage()
  → ensureMcpServers(mcpServers, workspaceRoot, agentType) [agent/mcp-config.ts]
    → switch(agentType):
      case "claude":
        → 写入 .claude/mcp.json（HTTP Server 用 mcp-remote 桥接）
        → 同步 .claude/settings.json 的 enabledMcpjsonServers
      case "opencode":
        → 写入 opencode.json（local/remote 类型）
      case "codex":
        → 写入 .codex/config.toml（strip-and-rebuild 策略）
```

### 3.3 Claude Code 特殊处理

```
ensureMcpServers(mcpServers, wsRoot, "claude")
  → 读取现有 .claude/mcp.json（保留用户自定义 Server）
  → 合并 Snail Shell 管理的 Server
  → HTTP Server → { command: "npx", args: ["mcp-remote@1", url] }（桥接）
  → 写入 .claude/mcp.json
  → 读取 .claude/settings.json
  → 更新 enabledMcpjsonServers 白名单
  → 写入 .claude/settings.json

Agent CLI 启动参数：
  → --mcp-config <wsRoot>/.claude/mcp.json
```

### 3.4 OpenCode 特殊处理

```
ensureMcpServers(mcpServers, wsRoot, "opencode")
  → 读取现有 opencode.json（保留用户自定义配置）
  → 合并 mcp 字段
  → 有 url → type: "remote"
  → 有 command → type: "local", command: [command, ...args]
  → 写入 opencode.json

Agent CLI：自动从 CWD 发现 opencode.json
```

### 3.5 Codex 特殊处理

```
ensureMcpServers(mcpServers, wsRoot, "codex")
  → 读取现有 .codex/config.toml
  → 移除所有 [mcp_servers.*] 段
  → 追加合并后的 [mcp_servers.*] 段
  → 有 url → url = "..."
  → 有 command → command = "...", args = "arg1 arg2"
  → 写入 .codex/config.toml

Agent CLI：通过 CODEX_HOME 环境变量发现配置
```

### 3.6 MCP Server 配置的完整生命周期

```
启动 → registerMcpServer("snail-final-response", url) → 平台 MCP Server 注册
  ↓
Agent 调用 → buildConversationCapability()
  → collectActiveMcpServers(wsRoot) → 合并平台 + workspace
  → MCPServerCapability[] → AgentCapability.mcpServers
  ↓
ensureMcpServers() → 写入 Agent 原生配置文件
  ↓
Agent CLI 启动 → 读取配置文件 → 连接 MCP Server
  ↓
Agent → initialize → tools/list → tools/call
  ↓
MCP Server 处理请求 → 返回结果
```

---

## 四、关键设计决策（v1）

1. **配置翻译而非直连** — Snail Shell 不直接作为 MCP Client，而是翻译配置让 Agent CLI 自行连接
2. **Agent 适配器模式** — 每个 Agent 有独立的配置写入逻辑，`ensureMcpServers()` 通过 agentType 分发
3. **保留用户配置** — 写入时保留 Agent 配置文件中已有的用户自定义 MCP Server
4. **HTTP 桥接** — Claude Code 不支持原生 HTTP MCP，通过 `mcp-remote@1` 桥接
5. **Strip-and-rebuild** — Codex 配置使用先删除再重建的策略，避免配置冲突
6. **Settings 同步** — Claude Code 需要 `.claude/mcp.json` 和 `.claude/settings.json` 双文件同步
7. **名称全局唯一** — 平台与 workspace MCP Server 名称冲突时阻断启动

---

## 五、v2 重写待决问题

1. **是否支持 Agent 直连 MCP Server？** 当前 Agent CLI 是实际的 MCP Client，是否需要 Snail Shell 自身作为 Client？
2. **配置文件管理是否简化？** 当前每个 Agent 有独立的配置写入逻辑，是否需要统一抽象？
3. **MCP Server 热更新？** 当前每次 Agent 调用时重写配置文件，是否需要监听变更？
4. **Claude Code HTTP 桥接是否优化？** `mcp-remote@1` 是否有性能/稳定性问题？
5. **配置冲突处理？** 当用户手动编辑配置文件时，Snail Shell 的写入策略如何协调？
6. **MCP Server 健康检查？** 是否需要在注入前检查 MCP Server 可用性？
7. **环境变量解析？** `.snail/mcp.json` 中的 `${GITHUB_TOKEN}` 占位符何时解析？
8. **MCP Server 权限控制？** 是否需要按 workspace/role 控制哪些 MCP Server 可用？
