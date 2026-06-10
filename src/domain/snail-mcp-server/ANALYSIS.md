# MCP Server 模块分析（v1 遗留）

> 本文档基于 `v1/` 目录下的遗留代码分析，用于指导 v2 重写。

---

## 一、业务场景

### 1.1 MCP Server 是什么

MCP Server 是 Snail Shell 向 AI Agent **暴露工具能力**的协议层。Snail Shell 作为 MCP Server，通过 JSON-RPC 2.0 over HTTP POST 协议，向连接的 Agent（Claude Code、OpenCode、Codex）提供可调用的工具。

核心设计：**单端点 + 单工具 + 上下文注入**。当前仅暴露一个 `set_final_body` 工具，通过 system prompt 注入 `<mcp_context>` 块传递 conversation_id 和 message_id，Agent 在回复结束前必须调用该工具声明最终展示内容。

### 1.2 核心业务场景

| 场景 | 说明 |
|------|------|
| **Agent 声明最终回复体** | Agent 调用 `set_final_body` 工具，显式声明消息的最终 Markdown 展示内容 |
| **终端上下文优先级** | `mcp_final_body` 优先于自动提取的终端上下文（event 流提取 / LLM 摘要） |
| **MCP 协议握手** | Agent 通过 `initialize` → `tools/list` → `tools/call` 标准流程发现和调用工具 |
| **平台 + Workspace 合并** | 平台 MCP Server（snail-final-response）与 workspace 自定义 MCP Server 合并，名称全局唯一 |

### 1.3 MCP Server 与其他模块的关系

- **Agent Runtime**：Agent 适配器在 invokeMessage 时将 MCP Server 配置写入 Agent 原生配置文件，Agent CLI 作为 MCP Client 连接
- **Message Protocol**：`invokeRuntimeMessage()` 注入 `<mcp_context>` 块到 system prompt，`persistTerminalMessageContext()` 消费 `mcp_final_body`
- **ACS（Agent Capability Spec）**：`mcpServers` 是 ACS 的 8 个维度之一
- **Prompt Center**：`buildConversationCapability()` 调用 `collectActiveMcpServers()` 收集 MCP Server 列表
- **IM Channel**：lobby-aware-channel 渲染消息时，`mcp_final_body` 优先于其他上下文类型
- **Web UI**：McpCenter 页面展示所有 MCP Server，区分 built-in 和用户自定义

---

## 二、数据模型

### 2.1 无数据库表

MCP Server 不入库，纯内存注册 + 文件配置。

### 2.2 TypeScript 类型定义

**MCPServerCapability**（ACS 维度）：
```typescript
interface MCPServerCapability {
  name: string;
  command?: string;              // stdio transport
  args?: string[];               // stdio transport
  env?: Record<string, string>;  // stdio transport
  url?: string;                  // HTTP transport
}
```

**McpServerDto**（API 响应）：
```typescript
interface McpServerDto {
  name: string;
  url?: string;
  command?: string;
  args?: string[];
  builtin: boolean;  // 是否平台内置
}
```

**MCP Server Info 常量**：
```typescript
const MCP_SERVER_INFO = {
  name: "snail-final-response",
  version: "1.0.0"
};
```

**MessageContextKind**（含 mcp_final_body）：
```typescript
type MessageContextKind =
  | "final_text"
  | "message_out"
  | "event_summary"
  | "llm_summary"
  | "mcp_final_body";  // MCP 工具写入的终端上下文
```

### 2.3 Workspace MCP 配置文件格式

`.snail/mcp.json`：
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

---

## 三、核心流程

### 3.1 MCP Server 启动流程

```
main.ts → server.listen(PORT)
  → startMcpServer(app, store, PORT)
    → registerMcpServer("snail-final-response", `http://localhost:${PORT}/snail-final-response`)
    → registerMcpEndpoint(app, store)
      → POST /snail-final-response → JSON-RPC handler
```

### 3.2 MCP 协议处理流程

```
Agent → POST /snail-final-response (JSON-RPC 2.0)
  → method: "initialize"
    → { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: {...} }
  → method: "tools/list"
    → { tools: [{ name: "set_final_body", ... }] }
  → method: "tools/call"
    → handleMcpToolCall(store, params)
      → 校验 text, conversation_id, message_id
      → store.getMessage(messageId, conversationId) → 校验消息存在
      → store.upsertMessageContext(messageId, "mcp_final_body", text, conversationId)
  → notification (无 id) → 204 No Content
  → unknown method → error -32601
```

### 3.3 set_final_body 工具定义

```typescript
{
  name: "set_final_body",
  description: "设置消息的最终展示正文（Markdown）",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "最终 Markdown 正文" },
      conversation_id: { type: "string" },
      message_id: { type: "string" }
    },
    required: ["text", "conversation_id", "message_id"]
  }
}
```

### 3.4 MCP 上下文注入流程

```
invokeRuntimeMessage()
  → 追加 <mcp_context> 到 system prompt：
    <mcp_context>
    conversation_id: {conversationId}
    message_id: {assistantMessageId}

    [HARD] 回复完成前必须调用 MCP 工具 set_final_body...
    </mcp_context>
```

### 3.5 终端上下文消费流程

```
persistTerminalMessageContext()
  → store.getMessageContext(messageId, conversationId)
  → if kind === "mcp_final_body" → 直接使用，跳过自动提取
  → else → buildTerminalMessageContext() → 从 event 流提取 / LLM 摘要
```

### 3.6 MCP Registry 两层合并

```
collectActiveMcpServers(workspaceRoot?)
  → platformServers（启动时 registerMcpServer 注册）
  + workspaceServers（.snail/mcp.json 加载）
  → 名称冲突 → throw Error
  → 返回合并列表（防御性拷贝）
```

---

## 四、关键设计决策（v1）

1. **HTTP POST 传输** — MCP Server 挂载在同一个 Express app 上，非独立进程，无 stdio 传输
2. **单工具设计** — 当前仅暴露 `set_final_body` 一个工具
3. **上下文注入驱动** — 通过 system prompt 的 `<mcp_context>` 块传递 conversation_id 和 message_id
4. **终端上下文最高优先级** — `mcp_final_body` 优先于自动提取的 event 流摘要
5. **两层 Registry 合并** — 平台 + workspace MCP Server 合并，名称全局唯一
6. **Agent 原生配置写入** — MCP Server 配置翻译为各 Agent CLI 的原生配置格式

---

## 五、v2 重写待决问题

1. **是否扩展工具集？** 当前仅 `set_final_body`，是否需要更多平台工具？
2. **传输协议是否扩展？** 当前仅 HTTP POST，是否需要支持 stdio / SSE 传输？
3. **MCP Server 是否独立进程？** 当前挂载在 Express app 上，是否需要独立部署？
4. **工具权限控制？** 是否需要按 Agent/Role 控制工具调用权限？
5. **工具调用审计？** 是否需要记录工具调用日志？
6. **MCP 协议版本管理？** 当前硬编码 "2025-03-26"，是否需要版本协商？
