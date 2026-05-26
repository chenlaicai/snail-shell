---
id: F2026052605
title: "[agent] MCP 最终正文：agent 显式声明消息最终展示内容"
from_ids: [F2026052601, F2026052602]
tags: [mcp, agent-protocol, prompt-injection]
modules: [agent]
---
# F2026052605 MCP 最终正文：agent 显式声明消息最终展示内容

## 背景

当前 Snail Shell 的消息上下文（`message_context`）由系统从事件流自动推断：扫描 events 取最后一个 text/content_block 事件作为 context。当 AI agent 先输出长分析、再输出短总结时，context 只捕获短总结，长分析被折叠进「流式过程」隐藏，用户实际看到的消息正文与 agent 意图展示的内容不一致。

根本问题：系统在「猜测」什么是最终答案，而非让 agent 显式声明。

## 目标

1. 让 agent 能通过 MCP 工具 **显式声明** 消息的最终展示正文（替代系统 auto-derive）
2. 保留 fallback：agent 未调用 MCP 时，退回现有 auto-derive 逻辑
3. MCP server 复用 Snail Shell 现有 Express 进程，使用 Streamable HTTP transport（非独立进程）
4. agent 通过系统提示词获知 `conversation_id` 和 `message_id`，调用 MCP 时显式传入

## 非目标

- 不改变现有 auto-derive 逻辑本身（只在其前增加 MCP 优先判断）
- 不改变前端事件流渲染结构（仅增加 `mcp_final_body` context kind 的识别）

## 设计

### 架构：MCP HTTP transport

```
agent 调用 set_final_body MCP tool
  → Claude Code HTTP POST /mcp
  → Express handler: JSON-RPC tools/call
  → store.upsertMessageContext(messageId, "mcp_final_body", text)
```

选择 HTTP transport 而非 stdio 独立进程的理由：
- MCP server 可直接复用 `ConversationStore`，无需独立数据库连接
- 无需额外环境变量（`SNAIL_DB_PATH`）
- 减少进程管理复杂度

### 数据流

```
System prompt 注入 <mcp_context>（含 conversation_id + message_id）
  → Agent 执行，可选调用 set_final_body
  → MCP server 写入 message_context 表（kind=mcp_final_body）

Agent 完成 → finalizeMessageLifecycle
  → persistTerminalMessageContext
    → getMessageContext → kind==="mcp_final_body"? 直接返回 : auto-derive
  → emit message_context_updated
  → 前端渲染
```

### 关键设计取舍

1. **MCP 优先于 auto-derive**：`persistTerminalMessageContext` 先检查 DB 中是否已有 MCP 设置的 context，有则跳过 `buildTerminalMessageContext`
2. **保留 fallback**：agent 未调用 MCP → DB 无 `mcp_final_body` → 退回原有 `buildTerminalMessageContext` 流程
3. **message_id 注入时机**：系统提示词构建在 message 创建之前，因此 message_id 在 `invokeRuntimeMessage` 中通过 `<mcp_context>` 块 post-hoc 注入
4. **`.mcp.json` 生命周期**：server 启动时一次性写入 `process.cwd()/.mcp.json`（MCP 标准 auto-discovery 路径），所有 MCP 兼容 agent（Claude Code、OpenCode、Codex）从 CWD 自动发现。写入时机在 `server.listen` 回调中，无竞态问题。`.gitignore` 忽略该文件防止提交。不再需要 per-invocation 临时文件管理。
5. **Guard 配置 per-invocation 隔离**：`writeClaudeGuardSettings` 和 `writeCodexGuardConfig` 接受可选 `targetDir` 参数。Codex adapter 使用 per-invocation 临时 `CODEX_HOME`；Claude Code 的 `.claude/` 目录暂无法重定向（无 `--settings` CLI 参数），当前保持写入 CWD，通过读取-合并-写入策略保证幂等性

### MCPServerCapability 类型扩展

```typescript
export interface MCPServerCapability {
  name: string;
  command?: string;   // stdio transport（改为可选）
  args?: string[];    // stdio transport（改为可选）
  env?: Record<string, string>;  // stdio transport
  url?: string;       // HTTP transport（新增）
}
```

## 生效路径

- `src/main.ts` — server 启动时写入 `.mcp.json` 到 CWD
- `src/agent/capability/spec.ts` — MCPServerCapability 类型定义
- `src/prompt-center/builder.ts` — 填充 mcpServers
- `src/agent/claude-code.ts` — MCP auto-discovery（从 CWD `.mcp.json`）
- `src/agent/claude-code-stateful.ts` — 同上
- `src/agent/opencode.ts` — 同上
- `src/agent/codex.ts` — 同上 + per-invocation 临时 `CODEX_HOME`
- `src/agent/guard-config.ts` — `writeClaudeGuardSettings` / `writeCodexGuardConfig` 接受 targetDir
- `src/interaction-entry/api/server.ts` — `POST /mcp` JSON-RPC endpoint
- `src/message-bus/message-protocol.ts` — MCP 优先检查 + ID 注入
- `src/shared/domain-types.ts` — `mcp_final_body` context kind
- `src/web/message-view.js` — 前端渲染识别
- `src/shared/domain-types.ts` — `mcp_final_body` context kind
- `src/web/message-view.js` — 前端渲染识别

## 改动范围

| 文件 | 变更类型 |
|------|----------|
| `src/main.ts` | 启动时 `mergeMcpJson`（读取-合并-写入），store 传递，移除 Gemini |
| `src/agent/capability/spec.ts` | 类型扩展，移除 Gemini 注释 |
| `src/agent/claude-code.ts` | MCP auto-discovery（无 per-invocation 逻辑） |
| `src/agent/claude-code-stateful.ts` | MCP auto-discovery |
| `src/agent/opencode.ts` | MCP auto-discovery，移除过时注释 |
| `src/agent/codex.ts` | MCP auto-discovery + per-invocation `CODEX_HOME` |
| `src/agent/guard-config.ts` | write 函数接受可选 targetDir |
| `src/agent/gemini.ts` | **移除** |
| `.gitignore` | `.mcp.json` 条目 |
| `tests/agent/mcp-config-test.ts` | **新增**：`mergeMcpJson` 6 种场景覆盖 |
| `src/interaction-entry/api/server.ts` | 新增 MCP 端点 |
| `src/main.ts` | store 传递，移除 Gemini 注册 |
| `src/message-bus/message-protocol.ts` | MCP 优先 + ID 注入 |
| `src/prompt-center/builder.ts` | mcpServers 填充 |
| `src/shared/domain-types.ts` | context kind 扩展 |
| `src/shared/types.ts` | AgentRuntime 移除 gemini-cli |
| `src/index.ts` | 移除 GeminiAgent export |
| `src/web/message-view.js` | 前端识别 |
| `tests/agent/gemini-parser-test.ts` | **移除** |
| `tests/interaction-entry/project-api-test.ts` | createServer 签名同步 |

## 验证

### 自检范围

1. TypeScript 编译通过 ✓
2. 链路完整性：
   - main.ts `mergeMcpJson` → 读取-合并写入 `.mcp.json` 到 CWD（保留用户已有 MCP 配置）
   - 所有 agent 通过 MCP standard auto-discovery 从 CWD 发现 `snail-final-body` tool
3. 行为测试：`tests/agent/mcp-config-test.ts` 覆盖 6 种合并场景
   - 新建、保留用户配置、更新 URL、缺失 key、非对象 key、保留顶层 key
4. Fallback 正确性：无 `mcp_final_body` → 退回 `buildTerminalMessageContext`
5. 前端渲染：`contextKindLabel` 识别 `mcp_final_body`，折叠条件包含该类型

### 未覆盖场景（需运行时验证）

- MCP HTTP transport 在 Claude Code 中的实际兼容性
- OpenCode 和 Codex 实际测试是否从 CWD `.mcp.json` 自动发现 MCP server（仅 Claude Code 已验证）

## 风险与决策记录

1. **MCP HTTP transport 兼容性**：`.mcp.json` 的 `url` 字段为 Streamable HTTP transport，当前假定此格式可用。Claude Code 已验证。
2. **`.mcp.json` 写入策略**：server 启动时一次性写入 `process.cwd()/.mcp.json`，所有 MCP 兼容 agent 通过标准 auto-discovery 机制发现。无需 per-invocation 临时文件管理，无竞态问题。`.gitignore` 忽略该文件。
3. **`message_id` 注入方式**：当前在 `invokeRuntimeMessage` 中通过字符串拼接注入 `<mcp_context>` 块，不是模板渲染。如未来系统提示词模板化改造，需注意此处一致性。
4. **Gemini agent 移除**：Gemini CLI 当前完全无法使用（未接入 GuardProfile、无 MCP 支持、无 per-project 配置），本轮一并移除。涉及：`src/agent/gemini.ts`、`tests/agent/gemini-parser-test.ts`、`src/main.ts` 注册、`src/index.ts` 导出、`src/shared/types.ts` `AgentRuntime` 类型、`config/snail-den.example.json` 示例 template、`capability/spec.ts` 和 `stateful-cli-agent.ts` 中的注释引用。
