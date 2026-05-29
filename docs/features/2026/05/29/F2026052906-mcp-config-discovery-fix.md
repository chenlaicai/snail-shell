---
id: F2026052906
title: "[agent] MCP 配置发现修复：显式 --mcp-config 替代 CWD 自动发现"
from_ids: [F2026052605]
tags: [mcp, agent-protocol, bugfix]
modules: [agent]
---
# F2026052906 MCP 配置发现修复：显式 --mcp-config 替代 CWD 自动发现

## 背景

F2026052605 实现了 MCP 最终正文机制，但该功能从未在运行时生效。agent 始终通过 CLI 直接输出最终回复，未调用 `set_final_body` MCP tool。

## 根因分析

`set_final_body` MCP tool 的发现依赖两个条件：
1. `.mcp.json` 文件存在于 agent 的 CWD
2. agent 能解析 `.mcp.json` 中 `url` 字段（HTTP transport）

当前实现存在两个失败点：

### 失败点 1：CWD 不匹配

`ensureMcpServers` 将 `.mcp.json` 写入 `process.cwd()`（server 进程 CWD），而 Claude Code 以 `cwd: input.projectRoot` 启动。两者可能不同，导致 agent 在自己的 CWD 中找不到 `.mcp.json`。

### 失败点 2：自动发现不支持 HTTP transport

Claude Code 的 `.mcp.json` 自动发现机制最初为 stdio transport（`command`/`args` 字段）设计。`url` 字段（HTTP Streamable transport）的支持是后加的，可能在某些版本中不被识别。

### 失败点 3：spec.ts 存在 merge conflict markers

`src/agent/capability/spec.ts` 中存在已提交的 `<<<<<<< HEAD` / `=======` / `>>>>>>> origin/main` merge conflict markers，导致 TypeScript 编译失败。

## 目标

1. Claude Code adapter 显式传入 `--mcp-config` 指向 `.mcp.json`，消除 CWD 依赖
2. 清理 `spec.ts` 中的 merge conflict markers
3. 保留 fallback：agent 未调用 MCP 时退回 auto-derive 逻辑（不变）

## 非目标

- 不修改 MCP server 端点逻辑
- 不修改 `ensureMcpServers` / `mergeMcpJson` 的写入逻辑
- 不修改前端渲染逻辑
- 不修改 OpenCode / Codex adapter（各自有独立 MCP 发现机制，另行处理）

## 设计

### 修复方案

在两个 Claude Code adapter（stateless + stateful）的 spawn args 中添加 `--mcp-config`，显式指向 `process.cwd()/.mcp.json`：

```typescript
// claude-code.ts invokeStateless — 在 args 构建后、spawnProcess 前
args.push("--mcp-config", join(process.cwd(), ".mcp.json"));

// claude-code-stateful.ts buildArgs — 在 args 构建后
args.push("--mcp-config", join(process.cwd(), ".mcp.json"));
```

**为什么选 `--mcp-config` 而非修改 CWD**：
- `--mcp-config` 是 Claude Code 官方支持的 CLI 参数，语义明确
- 不改变 agent 的工作目录，不影响 agent 的文件操作上下文
- `--mcp-config` 是 additive（不替换其他 MCP 来源），不会破坏用户在 `~/.claude/settings.json` 中配置的其他 MCP server

**为什么 `process.cwd()` 是正确的路径**：
- `ensureMcpServers` 写入 `process.cwd()/.mcp.json`
- `mergeMcpJson`（server 启动时）也写入 `process.cwd()/.mcp.json`
- 两者在同一进程中运行，`process.cwd()` 一致

### spec.ts 冲突解决

保留 HEAD 版本（包含 HTTP transport 说明和当前注入策略），更新注入策略注释以反映 `--mcp-config` 修复。

## 生效路径

- `src/agent/claude-code.ts` — `invokeStateless` 添加 `--mcp-config`
- `src/agent/claude-code-stateful.ts` — `buildArgs` 添加 `--mcp-config`
- `src/agent/capability/spec.ts` — 清理 merge conflict markers

## 验证

1. TypeScript 编译通过
2. 现有测试通过（`tests/agent/mcp-config-test.ts`、`tests/agent/mcp-endpoint-test.ts`）
3. 运行时验证：agent spawn 时 args 包含 `--mcp-config <path>/.mcp.json`
